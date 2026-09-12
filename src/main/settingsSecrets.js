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

function decodeLegacyEncryptedSettings(value, storageOverride, decodedSecrets = []) {
  if (!legacyEncryptedSettingsPresent(value)) return structuredClone(value);
  const storage = resolveLegacySecretStorage(storageOverride);
  if (!storage || typeof storage.decryptString !== "function") {
    throw Object.assign(new Error("旧版加密设置暂时无法解密，原文件未修改"), {
      code: LEGACY_SECRET_DECRYPTION_FAILED,
    });
  }

  const decode = (current, key = "") => {
    if (typeof current === "string" && current.startsWith(LEGACY_ENCRYPTED_SECRET_PREFIX)) {
      const encoded = current.slice(LEGACY_ENCRYPTED_SECRET_PREFIX.length);
      if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        throw new Error("旧版加密设置内容不合法");
      }
      const plaintext = storage.decryptString(Buffer.from(encoded, "base64"));
      decodedSecrets.push({ key, plaintext, ciphertext: current });
      return plaintext;
    }
    if (Array.isArray(current)) return current.map((nested) => decode(nested, key));
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(
      Object.entries(current).map(([nestedKey, nested]) => [nestedKey, decode(nested, nestedKey)]),
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

const LOCAL_SECRET_KEYS = new Set(["saved_password", "apikey", "api_key"]);
const PORTABLE_CREDENTIAL_KEYS = new Set([
  ...LOCAL_SECRET_KEYS,
  "password",
  "token",
  "frps_token",
  "proxy_uuid",
  "vmess_uuid",
  "uuid",
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
  const collect = (current, key = "") => {
    if (typeof current === "string" && current && LOCAL_SECRET_KEYS.has(key.toLowerCase())) {
      if (!current.startsWith(LEGACY_ENCRYPTED_SECRET_PREFIX)) {
        const values = previousPlaintext.get(key) || new Set();
        values.add(current);
        previousPlaintext.set(key, values);
      }
    } else if (Array.isArray(current)) current.forEach((nested) => collect(nested, key));
    else if (current && typeof current === "object")
      Object.entries(current).forEach(([nestedKey, nested]) => collect(nested, nestedKey));
  };
  collect(previous);

  const protect = (current, key = "") => {
    if (typeof current === "string") {
      const known = decodedSecrets.find(
        (record) =>
          record.key === key && (record.plaintext === current || record.ciphertext === current),
      );
      if (known) return known.ciphertext;
      if (!current || !LOCAL_SECRET_KEYS.has(key.toLowerCase())) return current;
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
            "系统安全存储不可用，无法保存新的密码或 API 密钥。请解锁系统钥匙串，或暂不记住密码后重试。",
          ),
          { code: "SECRET_STORAGE_UNAVAILABLE" },
        );
      }
      try {
        const encrypted = storage.encryptString(current);
        if (!Buffer.isBuffer(encrypted) || !encrypted.length)
          throw new Error("empty encryption result");
        const ciphertext = LEGACY_ENCRYPTED_SECRET_PREFIX + encrypted.toString("base64");
        decodedSecrets.push({ key, plaintext: current, ciphertext });
        return ciphertext;
      } catch {
        if (previousPlaintext.get(key)?.has(current)) return current;
        throw Object.assign(
          new Error(
            "系统安全存储未能保护密码或 API 密钥，本次设置未保存。请解锁系统钥匙串后重试。",
          ),
          { code: "SECRET_STORAGE_FAILED" },
        );
      }
    }
    if (Array.isArray(current)) return current.map((nested) => protect(nested, key));
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(
      Object.entries(current).map(([nestedKey, nested]) => [nestedKey, protect(nested, nestedKey)]),
    );
  };
  return protect(value);
}

function portableSettings(value, includeSecrets = false) {
  const strip = (current, key = "") => {
    if (PORTABLE_CREDENTIAL_KEYS.has(key.toLowerCase()) && typeof current === "string")
      return includeSecrets ? current : "";
    if (Array.isArray(current)) return current.map((nested) => strip(nested, key));
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(
      Object.entries(current).map(([nestedKey, nested]) => [nestedKey, strip(nested, nestedKey)]),
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
  LEGACY_SECRET_DECRYPTION_FAILED,
  decodeLegacyEncryptedSettings,
  protectSettingsSecrets,
  portableSettings,
};
