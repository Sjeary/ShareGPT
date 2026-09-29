const LEGACY_ENCRYPTED_SECRET_PREFIX = "sharegpt-safe:v1:";
const LEGACY_SECRET_DECRYPTION_FAILED = "LEGACY_SECRET_DECRYPTION_FAILED";

function legacyEncryptedSettingsPresent(value) {
  if (typeof value === "string") return value.startsWith(LEGACY_ENCRYPTED_SECRET_PREFIX);
  if (Array.isArray(value)) return value.some(legacyEncryptedSettingsPresent);
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(legacyEncryptedSettingsPresent);
}

function resolveLegacySecretStorage(storageOverride) {
  if (storageOverride !== undefined) return storageOverride;
  try {
    const electron = require("electron");
    const storage = electron?.safeStorage;
    return storage?.isEncryptionAvailable?.() ? storage : null;
  } catch {
    return null;
  }
}

function decodeLegacyEncryptedSettings(
  value,
  storageOverride,
  decodedSecrets = [],
  cachedSecrets = [],
) {
  if (!legacyEncryptedSettingsPresent(value)) return structuredClone(value);
  let storage;

  const decode = (current, key = "", keys = []) => {
    if (typeof current === "string" && current.startsWith(LEGACY_ENCRYPTED_SECRET_PREFIX)) {
      const cached = cachedSecrets.find(
        (record) => record.key === key && record.ciphertext === current,
      );
      if (cached) {
        decodedSecrets.push(cached);
        return cached.plaintext;
      }
      const encoded = current.slice(LEGACY_ENCRYPTED_SECRET_PREFIX.length);
      if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        throw new Error("旧版加密设置内容不合法");
      }
      storage ||= resolveLegacySecretStorage(storageOverride);
      if (!storage || typeof storage.decryptString !== "function") {
        throw Object.assign(new Error("旧版加密设置暂时无法解密，原文件未修改"), {
          code: LEGACY_SECRET_DECRYPTION_FAILED,
        });
      }
      const plaintext = storage.decryptString(Buffer.from(encoded, "base64"));
      decodedSecrets.push({ key, path: JSON.stringify(keys), plaintext, ciphertext: current });
      return plaintext;
    }
    if (Array.isArray(current))
      return current.map((nested, index) => decode(nested, key, [...keys, String(index)]));
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(
      Object.entries(current).map(([nestedKey, nested]) => [
        nestedKey,
        decode(nested, nestedKey, [...keys, nestedKey]),
      ]),
    );
  };

  try {
    return decode(value);
  } catch (error) {
    if (error?.code === LEGACY_SECRET_DECRYPTION_FAILED) throw error;
    throw Object.assign(
      new Error(`旧版加密设置解密失败，原文件未修改：${error.message || error}`),
      {
        code: LEGACY_SECRET_DECRYPTION_FAILED,
        cause: error,
      },
    );
  }
}

const LOCAL_SECRET_KEYS = new Set([
  "saved_password",
  "apikey",
  "api_key",
  "proxy_uuid",
  "vmess_uuid",
  "frps_token",
]);

// Generic IDs are not credentials. Only UUID/password values inside a sender
// proxy outbound belong to the secure-storage boundary (including Principal copies).
function isLocalSecretPath(keys) {
  const key = String(keys.at(-1) || "").toLowerCase();
  if (LOCAL_SECRET_KEYS.has(key)) return true;
  if (!["uuid", "password"].includes(key)) return false;
  const sender = keys.lastIndexOf("sender");
  if (sender < 0) return false;
  const suffix = keys.slice(sender + 1);
  return (
    suffix[0] === "airport_outbound" ||
    (suffix[0] === "managed_proxy_routes" &&
      /^\d+$/.test(suffix[1] || "") &&
      suffix[2] === "outbound")
  );
}
const PORTABLE_CREDENTIAL_KEYS = new Set([
  ...LOCAL_SECRET_KEYS,
  "password",
  "token",
  "secret",
  "authorization",
]);

function protectSettingsSecrets(
  value,
  {
    storageOverride = undefined,
    decodedSecrets = [],
    previous = {},
    trustedCiphertext = false,
  } = {},
) {
  let storage;
  let storageResolved = false;
  const previousPlaintext = new Map();
  const collect = (current, keys = []) => {
    const key = keys.at(-1) || "";
    if (typeof current === "string" && current && isLocalSecretPath(keys)) {
      if (!current.startsWith(LEGACY_ENCRYPTED_SECRET_PREFIX)) {
        const values = previousPlaintext.get(key) || new Set();
        values.add(current);
        previousPlaintext.set(key, values);
      }
    } else if (Array.isArray(current))
      current.forEach((nested, index) => collect(nested, [...keys, String(index)]));
    else if (current && typeof current === "object")
      Object.entries(current).forEach(([nestedKey, nested]) =>
        collect(nested, [...keys, nestedKey]),
      );
  };
  collect(previous);

  const protect = (current, keys = []) => {
    const key = keys.at(-1) || "";
    const secret = isLocalSecretPath(keys);
    if (typeof current === "string") {
      const known = decodedSecrets.find(
        (record) =>
          record.key === key &&
          (secret || record.path === JSON.stringify(keys)) &&
          (record.plaintext === current || record.ciphertext === current),
      );
      if (known) return known.ciphertext;
      if (!current || !secret) return current;
      if (trustedCiphertext && current.startsWith(LEGACY_ENCRYPTED_SECRET_PREFIX)) {
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(current.slice(LEGACY_ENCRYPTED_SECRET_PREFIX.length))) {
          throw new Error("已有加密凭据内容无效，原文件未修改");
        }
        return current;
      }
      if (!storageResolved) {
        storage = resolveLegacySecretStorage(storageOverride);
        storageResolved = true;
        if (storage?.getSelectedStorageBackend?.() === "basic_text") storage = null;
      }
      if (
        !storage ||
        typeof storage.encryptString !== "function" ||
        storage.isEncryptionAvailable?.() === false
      ) {
        // Existing plaintext can still be read and carried through an unrelated legacy
        // migration. New/changed secrets never silently fall back to plaintext storage.
        if (previousPlaintext.get(key)?.has(current)) return current;
        throw Object.assign(
          new Error(
            "系统安全存储不可用，无法保存新的密码、代理凭据或 API 密钥。请解锁系统钥匙串后重试。",
          ),
          { code: "SECRET_STORAGE_UNAVAILABLE" },
        );
      }
      try {
        const encrypted = storage.encryptString(current);
        if (!Buffer.isBuffer(encrypted) || !encrypted.length)
          throw new Error("empty encryption result");
        const ciphertext = LEGACY_ENCRYPTED_SECRET_PREFIX + encrypted.toString("base64");
        decodedSecrets.push({ key, path: JSON.stringify(keys), plaintext: current, ciphertext });
        return ciphertext;
      } catch {
        if (previousPlaintext.get(key)?.has(current)) return current;
        throw Object.assign(
          new Error(
            "系统安全存储未能保护密码、代理凭据或 API 密钥，本次设置未保存。请解锁系统钥匙串后重试。",
          ),
          { code: "SECRET_STORAGE_FAILED" },
        );
      }
    }
    if (Array.isArray(current))
      return current.map((nested, index) => protect(nested, [...keys, String(index)]));
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(
      Object.entries(current).map(([nestedKey, nested]) => [
        nestedKey,
        protect(nested, [...keys, nestedKey]),
      ]),
    );
  };
  return protect(value);
}

function portableSettings(value, includeSecrets = false) {
  const strip = (current, keys = []) => {
    const key = String(keys.at(-1) || "").toLowerCase();
    if (
      (PORTABLE_CREDENTIAL_KEYS.has(key) || isLocalSecretPath(keys)) &&
      typeof current === "string"
    )
      return includeSecrets ? current : "";
    if (Array.isArray(current))
      return current.map((nested, index) => strip(nested, [...keys, String(index)]));
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(
      Object.entries(current).map(([nestedKey, nested]) => [
        nestedKey,
        strip(nested, [...keys, nestedKey]),
      ]),
    );
  };
  const result = strip(value);
  if (!includeSecrets && result?.collab) {
    result.collab.remember_password = false;
    result.collab.auto_login = false;
  }
  return result;
}

module.exports = {
  LOCAL_SECRET_KEYS,
  isLocalSecretPath,
  LEGACY_SECRET_DECRYPTION_FAILED,
  decodeLegacyEncryptedSettings,
  protectSettingsSecrets,
  portableSettings,
};
