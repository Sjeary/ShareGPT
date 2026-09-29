const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  Backend,
  decodeLegacyEncryptedSettings,
  protectSettingsSecrets,
  portableSettings,
} = require("../backend");

function storageFixture() {
  const values = new Map();
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const token = `ciphertext-${values.size}`;
      values.set(token, value);
      return Buffer.from(token);
    },
    decryptString(ciphertext) {
      const result = values.get(ciphertext.toString());
      if (result === undefined) throw new Error("unrecognized ciphertext");
      return result;
    },
  };
  return storage;
}

function backendFixture(t, storage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-secret-settings-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const backend = Object.create(Backend.prototype);
  Object.assign(backend, {
    settingsFile: path.join(dir, "settings.json"),
    legacySecretStorage: storage,
    legacyEncryptedSecrets: [],
  });
  return backend;
}

test("fresh and changed secrets encrypt at rest, including the previous backup", (t) => {
  const storage = storageFixture();
  const backend = backendFixture(t, storage);
  fs.writeFileSync(
    backend.settingsFile,
    JSON.stringify({ collab: { saved_password: "legacy-password" } }),
  );
  const input = {
    collab: { saved_password: "new-password" },
    principalSettings: { byPrincipal: { alice: { translation: { ai: { apiKey: "new-key" } } } } },
  };
  backend.writeStoredSettings(input);
  for (const file of [backend.settingsFile, `${backend.settingsFile}.bak`]) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /legacy-password|new-password|new-key/);
  }
  assert.deepEqual(
    decodeLegacyEncryptedSettings(
      JSON.parse(fs.readFileSync(backend.settingsFile, "utf8")),
      storage,
    ),
    input,
  );
  assert.equal(
    decodeLegacyEncryptedSettings(
      JSON.parse(fs.readFileSync(`${backend.settingsFile}.bak`, "utf8")),
      storage,
    ).collab.saved_password,
    "legacy-password",
  );
});

test("unchanged ciphertext is reused with no encryption call; changed secret errors preserve files", (t) => {
  const storage = storageFixture();
  const backend = backendFixture(t, storage);
  backend.writeStoredSettings({ collab: { saved_password: "first" }, ui: { theme: "dark" } });
  const beforeCipher = JSON.parse(fs.readFileSync(backend.settingsFile, "utf8")).collab
    .saved_password;
  backend.legacySecretStorage = {
    encryptString() {
      throw new Error("should not reencrypt");
    },
  };
  backend.writeStoredSettings({ collab: { saved_password: "first" }, ui: { theme: "light" } });
  assert.equal(
    JSON.parse(fs.readFileSync(backend.settingsFile, "utf8")).collab.saved_password,
    beforeCipher,
  );
  const before = fs.readFileSync(backend.settingsFile, "utf8");
  const beforeBackup = fs.readFileSync(`${backend.settingsFile}.bak`, "utf8");
  assert.throws(() => backend.writeStoredSettings({ collab: { saved_password: "second" } }), {
    code: "SECRET_STORAGE_FAILED",
  });
  assert.equal(fs.readFileSync(backend.settingsFile, "utf8"), before);
  assert.equal(fs.readFileSync(`${backend.settingsFile}.bak`, "utf8"), beforeBackup);
});

test("unavailable and insecure storage reject new secrets, but preserve legacy values through unrelated saves", (t) => {
  for (const storage of [
    null,
    { isEncryptionAvailable: () => false },
    {
      getSelectedStorageBackend: () => "basic_text",
      encryptString: () => Buffer.from("not-secure"),
    },
  ]) {
    const backend = backendFixture(t, storage);
    const legacy = {
      collab: { saved_password: "existing-legacy-password" },
      ui: { theme: "dark" },
    };
    fs.writeFileSync(backend.settingsFile, JSON.stringify(legacy));
    backend.writeStoredSettings({ ...legacy, ui: { theme: "light" } });
    const before = fs.readFileSync(backend.settingsFile, "utf8");
    assert.throws(() => backend.writeStoredSettings({ collab: { saved_password: "different" } }), {
      code: "SECRET_STORAGE_UNAVAILABLE",
    });
    assert.equal(fs.readFileSync(backend.settingsFile, "utf8"), before);
    assert.equal(JSON.parse(before).collab.saved_password, "existing-legacy-password");
  }
  assert.deepEqual(
    protectSettingsSecrets({ collab: { saved_password: "" } }, { storageOverride: null }),
    { collab: { saved_password: "" } },
  );
});

test("update snapshots protect legacy default-file keys and never copy them as plaintext", (t) => {
  const storage = storageFixture();
  const backend = backendFixture(t, storage);
  const dir = path.dirname(backend.settingsFile);
  Object.assign(backend, {
    app: { getPath: () => dir, getName: () => "ShareGPT", getVersion: () => "1.0.10-test" },
    updateBackupsDir: path.join(dir, "backups"),
  });
  fs.writeFileSync(
    path.join(dir, "private.defaults.local.json"),
    JSON.stringify({ translation: { ai: { apiKey: "legacy-default-key" } } }),
  );
  const backup = backend.createUpdateBackup("fixture");
  const contents = fs.readFileSync(
    path.join(backup.backupDir, "private.defaults.local.json"),
    "utf8",
  );
  assert.doesNotMatch(contents, /legacy-default-key/);
  assert.equal(
    decodeLegacyEncryptedSettings(JSON.parse(contents), storage).translation.ai.apiKey,
    "legacy-default-key",
  );
  backend.legacySecretStorage = null;
  assert.throws(() => backend.createUpdateBackup("unavailable-fixture"), /备份未完全成功/);
  assert.match(
    fs.readFileSync(path.join(dir, "private.defaults.local.json"), "utf8"),
    /legacy-default-key/,
  );
});

test("a locked encryptor does not block unrelated edits of an unchanged legacy plaintext value", (t) => {
  const backend = backendFixture(t, {
    isEncryptionAvailable: () => true,
    encryptString() {
      throw new Error("locked keychain");
    },
  });
  const legacy = { collab: { saved_password: "existing-password" }, ui: { theme: "dark" } };
  fs.writeFileSync(backend.settingsFile, JSON.stringify(legacy));
  backend.writeStoredSettings({ ...legacy, ui: { theme: "light" } });
  assert.equal(JSON.parse(fs.readFileSync(backend.settingsFile, "utf8")).ui.theme, "light");
  assert.throws(() => backend.writeStoredSettings({ collab: { saved_password: "new-password" } }), {
    code: "SECRET_STORAGE_FAILED",
  });
});

test("fresh default examples never materialize password or API key values or invoke secure storage", (t) => {
  const backend = backendFixture(t, {
    encryptString() {
      throw new Error("must not touch secure storage for templates");
    },
  });
  const dir = path.dirname(backend.settingsFile);
  const defaults = path.join(dir, "private.defaults.local.json");
  const example = path.join(dir, "example.json");
  fs.writeFileSync(
    example,
    JSON.stringify({
      collab: { saved_password: "example-password" },
      translation: { ai: { apiKey: "example-key" } },
    }),
  );
  Object.assign(backend, {
    app: { getPath: () => dir },
    resolvePrivateDefaultsCandidates: () => [defaults],
    resolveExampleDefaultsCandidates: () => [example],
  });
  backend.ensureLocalDefaultsFile();
  assert.doesNotMatch(fs.readFileSync(defaults, "utf8"), /example-password|example-key/);
  assert.equal(JSON.parse(fs.readFileSync(defaults, "utf8")).collab.saved_password, "");
});

test("portable exports omit credentials by default and include plaintext only with explicit opt-in", () => {
  const input = {
    collab: { saved_password: "password", remember_password: true, auto_login: true },
    sender: { proxy_server: "proxy.example", proxy_uuid: "route-secret" },
    translation: { ai: { apiKey: "api-secret", model: "model" } },
    principalSettings: {
      byPrincipal: { alice: { translation: { ai: { api_key: "nested-secret" } } } },
    },
  };
  const safe = portableSettings(input);
  assert.doesNotMatch(JSON.stringify(safe), /route-secret|api-secret|nested-secret/);
  assert.equal(safe.collab.saved_password, "");
  assert.equal(safe.collab.remember_password, false);
  assert.equal(safe.sender.proxy_server, "proxy.example");
  assert.equal(safe.translation.ai.model, "model");
  assert.deepEqual(portableSettings(input, true), input);
  assert.equal(input.collab.saved_password, "password");
});

test("the production export dialog defaults to no secrets; explicit include keeps the portable format", async (t) => {
  const backend = backendFixture(t, null);
  const dir = path.dirname(backend.settingsFile);
  let response = 0;
  let lastChoice = { defaultId: -1 };
  const file = path.join(dir, "export.json");
  Object.assign(backend, {
    getWindow: () => ({}),
    app: { getPath: () => dir },
    getPrincipalContext: () => ({ principalId: "local-device", generation: 1 }),
    assertSettingsPrincipalSnapshot: () => {},
    loadSettings: () => ({
      collab: { saved_password: "private-password" },
      translation: { ai: { apiKey: "private-key" } },
    }),
    loadChatHistory: () => ({ conversations: { room: [{ text: "kept message" }] } }),
    dialog: {
      showMessageBox: async (_window, options) => {
        lastChoice = options;
        return { response };
      },
      showSaveDialog: async () => ({ filePath: file, canceled: false }),
    },
  });
  await backend.exportUserData();
  assert.equal(lastChoice.defaultId, 0);
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /private-password|private-key/);
  response = 1;
  await backend.exportUserData();
  const exported = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(exported.format, "sharegpt-user-data");
  assert.equal(exported.version, 1);
  assert.equal(exported.settings.collab.saved_password, "private-password");
  assert.equal(exported.settings.translation.ai.apiKey, "private-key");
  assert.equal(exported.chatHistory.conversations.room[0].text, "kept message");
  response = 2;
  assert.equal(await backend.exportUserData(), null);
});

function proxySettings(label = "old") {
  const sender = {
    proxy_uuid: `${label}-unified-credential`,
    managed_proxy_routes: [
      {
        id: "route-id",
        uuid: "route-metadata-id",
        outbound: { type: "vmess", uuid: `${label}-vmess-credential` },
      },
      { id: "password-route", outbound: { type: "socks", password: `${label}-socks-credential` } },
    ],
    airport_outbound: {
      type: "trojan",
      password: `${label}-airport-credential`,
      uuid: `${label}-airport-uuid-credential`,
    },
  };
  return {
    sender,
    receiver: {
      vmess_uuid: `${label}-legacy-credential`,
      frps_token: `${label}-legacy-token-credential`,
    },
    principalSettings: { byPrincipal: { alice: { sender: structuredClone(sender) } } },
    ui: { uuid: "business-id", theme: "dark" },
  };
}

test("proxy credentials encrypt in settings, previous backups and update snapshots, then survive restart", (t) => {
  const storage = storageFixture();
  const backend = backendFixture(t, storage);
  const legacy = proxySettings("old"),
    next = proxySettings("new");
  fs.writeFileSync(backend.settingsFile, JSON.stringify(legacy));
  backend.writeStoredSettings(next);
  for (const [file, expected] of [
    [backend.settingsFile, next],
    [`${backend.settingsFile}.bak`, legacy],
  ]) {
    const raw = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(raw, /(?:old|new)-[a-z-]*credential/);
    assert.deepEqual(decodeLegacyEncryptedSettings(JSON.parse(raw), storage), expected);
    assert.match(raw, /business-id|route-metadata-id/);
  }
  const restarted = Object.create(Backend.prototype);
  Object.assign(restarted, {
    settingsFile: backend.settingsFile,
    legacySecretStorage: storage,
    legacyEncryptedSecrets: [],
    loadPrivateDefaults: () => ({}),
  });
  const runtime = restarted.readStoredSettings();
  assert.deepEqual(runtime.sender, next.sender);
  assert.deepEqual(runtime.principalSettings.byPrincipal.alice.sender, next.sender);
  restarted.legacySecretStorage = null;
  restarted.writeStoredSettings({ ...runtime, ui: { ...runtime.ui, theme: "light" } });
  assert.doesNotMatch(fs.readFileSync(backend.settingsFile, "utf8"), /new-[a-z-]*credential/);

  const dir = path.dirname(backend.settingsFile);
  Object.assign(backend, {
    app: { getPath: () => dir, getName: () => "ShareGPT", getVersion: () => "test" },
    updateBackupsDir: path.join(dir, "backups"),
  });
  fs.writeFileSync(path.join(dir, "private.defaults.local.json"), JSON.stringify(legacy));
  const backup = backend.createUpdateBackup("proxy-fixture");
  for (const name of ["settings.json", "private.defaults.local.json"]) {
    const raw = fs.readFileSync(path.join(backup.backupDir, name), "utf8");
    assert.doesNotMatch(raw, /(?:old|new)-[a-z-]*credential/);
    assert.ok(decodeLegacyEncryptedSettings(JSON.parse(raw), storage).sender.proxy_uuid);
  }
});

test("unavailable secure storage carries old proxy values but rejects every new or changed credential", (t) => {
  const replacements = [
    (value) => {
      value.sender.proxy_uuid = "new-secret";
    },
    (value) => {
      value.receiver.vmess_uuid = "new-secret";
    },
    (value) => {
      value.receiver.frps_token = "new-secret";
    },
    (value) => {
      value.sender.managed_proxy_routes[0].outbound.uuid = "new-secret";
    },
    (value) => {
      value.sender.managed_proxy_routes[1].outbound.password = "new-secret";
    },
    (value) => {
      value.sender.airport_outbound.uuid = "new-secret";
    },
    (value) => {
      value.sender.airport_outbound.password = "new-secret";
    },
    (value) => {
      value.principalSettings.byPrincipal.alice.sender.proxy_uuid = "new-secret";
    },
  ];
  for (const storage of [
    null,
    { getSelectedStorageBackend: () => "basic_text" },
    {
      isEncryptionAvailable: () => true,
      encryptString() {
        throw new Error("locked");
      },
    },
  ]) {
    const backend = backendFixture(t, storage);
    const legacy = proxySettings();
    fs.writeFileSync(backend.settingsFile, JSON.stringify(legacy));
    backend.writeStoredSettings({ ...legacy, ui: { ...legacy.ui, theme: "light" } });
    const before = fs.readFileSync(backend.settingsFile, "utf8");
    const oldBackup = fs.readFileSync(`${backend.settingsFile}.bak`, "utf8");
    for (const change of replacements) {
      const next = structuredClone(legacy);
      change(next);
      assert.throws(
        () => backend.writeStoredSettings(next),
        (error) =>
          error instanceof Error && /^SECRET_STORAGE_/.test(String(Reflect.get(error, "code"))),
      );
      assert.equal(fs.readFileSync(backend.settingsFile, "utf8"), before);
      assert.equal(fs.readFileSync(`${backend.settingsFile}.bak`, "utf8"), oldBackup);
    }
    assert.throws(
      () => protectSettingsSecrets(legacy, { storageOverride: storage }),
      (error) =>
        error instanceof Error && /^SECRET_STORAGE_/.test(String(Reflect.get(error, "code"))),
    );
  }
});

test("proxy templates and portable exports omit credentials while business UUIDs remain ordinary data", (t) => {
  const input = proxySettings();
  const safe = portableSettings(input);
  assert.doesNotMatch(JSON.stringify(safe), /old-[a-z-]*credential/);
  assert.equal(safe.ui.uuid, "business-id");
  assert.equal(safe.sender.managed_proxy_routes[0].uuid, "route-metadata-id");
  assert.deepEqual(portableSettings(input, true), input);
  const decodedSecrets = [];
  const sameUuid = {
    sender: input.sender,
    ui: { uuid: input.sender.managed_proxy_routes[0].outbound.uuid },
  };
  const protectedSettings = protectSettingsSecrets(sameUuid, {
    storageOverride: storageFixture(),
    decodedSecrets,
  });
  assert.equal(
    protectedSettings.ui.uuid,
    sameUuid.ui.uuid,
    "matching a cached secret does not turn a business ID into a credential",
  );

  const backend = backendFixture(t, null),
    dir = path.dirname(backend.settingsFile);
  const defaults = path.join(dir, "private.defaults.local.json"),
    example = path.join(dir, "example.json");
  fs.writeFileSync(example, JSON.stringify(input));
  Object.assign(backend, {
    app: { getPath: () => dir },
    resolvePrivateDefaultsCandidates: () => [defaults],
    resolveExampleDefaultsCandidates: () => [example],
  });
  backend.ensureLocalDefaultsFile();
  const template = JSON.parse(fs.readFileSync(defaults, "utf8"));
  assert.doesNotMatch(JSON.stringify(template), /old-[a-z-]*credential/);
  assert.equal(template.ui.uuid, "business-id");
  assert.equal(template.sender.managed_proxy_routes[0].uuid, "route-metadata-id");
});
