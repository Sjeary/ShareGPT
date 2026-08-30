const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Backend, decodeLegacyEncryptedSettings, prepareImportedSettings } = require("../backend");
const { principalIdFor } = require("../principal");

function createBackend(t, dependencies = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-principal-settings-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = {
    isPackaged: true,
    getName: () => "ShareGPT",
    getVersion: () => "1.0.9-test",
    getPath(name) {
      if (name === "exe") return path.join(root, "ShareGPT");
      const target = path.join(root, name);
      fs.mkdirSync(target, { recursive: true });
      return target;
    },
  };
  return new Backend(app, () => null, "all", dependencies);
}

function principalId(backend) {
  return backend.getPrincipalContext().principalId;
}

function patchSettings(backend, section, patch, revision, expectedPrincipalId, generation) {
  return backend.patchSettings(
    section,
    patch,
    revision,
    expectedPrincipalId,
    Number.isInteger(generation) ? generation : backend.getPrincipalContext().generation,
  );
}

function operateSettings(backend, section, operations, revision, expectedPrincipalId, generation) {
  return backend.operateSettings(
    section,
    operations,
    revision,
    expectedPrincipalId,
    Number.isInteger(generation) ? generation : backend.getPrincipalContext().generation,
  );
}

function saveSettingsForPrincipal(backend, settings, expectedPrincipalId, generation) {
  return backend.saveSettingsForPrincipal(
    settings,
    expectedPrincipalId,
    Number.isInteger(generation) ? generation : backend.getPrincipalContext().generation,
  );
}

test("legacy settings are claimed only by the exact server path and username", (t) => {
  const backend = createBackend(t);
  fs.writeFileSync(
    backend.settingsFile,
    JSON.stringify({
      settingsRevision: 4,
      collab: { server_url: "https://collab.example/team-a", last_username: "Alice" },
      advancedAi: {
        version: 1,
        enabled: true,
        environments: [{ id: "alice-env", kind: "gpt", name: "Alice", routeId: "route-a" }],
        activeByKind: { gpt: "alice-env", gemini: "", claude: "" },
      },
      notesAi: { baseUrl: "http://ai.example", apiKey: "alice-key", model: "m" },
    }),
  );

  assert.deepEqual(
    backend.activatePrincipal("https://collab.example/team-b", "Alice").settings.advancedAi
      .environments,
    [],
  );
  assert.deepEqual(
    backend.activatePrincipal("https://collab.example/team-a", "alice").settings.advancedAi
      .environments,
    [],
  );
  const exact = backend.activatePrincipal("https://collab.example/team-a", "Alice").settings;
  assert.equal(exact.advancedAi.environments[0].id, "alice-env");
  assert.equal(exact.translation.ai.apiKey, "alice-key");
});

test("A/B/A keeps each account's environments and Notes AI configuration", (t) => {
  const backend = createBackend(t);
  const alice = backend.activatePrincipal("https://collab.example/root", "Alice");
  let saved = patchSettings(
    backend,
    "advancedAi",
    {
      enabled: true,
      environments: [{ id: "alice-env", kind: "gpt", name: "Alice", routeId: "route-a" }],
      activeByKind: { gpt: "alice-env", gemini: "", claude: "" },
    },
    alice.settings.settingsRevision,
    alice.principalId,
  );
  patchSettings(
    backend,
    "translation",
    { ai: { baseUrl: "http://alice.example", apiKey: "alice-key", model: "a" } },
    saved.settingsRevision,
    alice.principalId,
  );

  const bob = backend.activatePrincipal("https://collab.example/root", "Bob");
  assert.deepEqual(bob.settings.advancedAi.environments, []);
  saved = patchSettings(
    backend,
    "translation",
    { ai: { baseUrl: "https://bob.example", apiKey: "bob-key", model: "b" } },
    bob.settings.settingsRevision,
    bob.principalId,
  );
  assert.equal(saved.translation.ai.apiKey, "bob-key");

  const aliceAgain = backend.activatePrincipal("https://collab.example/root", "Alice").settings;
  assert.equal(aliceAgain.advancedAi.environments[0].id, "alice-env");
  assert.equal(aliceAgain.translation.ai.apiKey, "alice-key");
});

test("ordinary AI partitions are isolated while the exact 1.0.8 owner keeps legacy data", (t) => {
  const backend = createBackend(t);
  fs.writeFileSync(
    backend.settingsFile,
    JSON.stringify({
      collab: { server_url: "https://collab.example/team", last_username: "Alice" },
      gpt: { partition: "persist:gpt-chat-profile-existing" },
    }),
  );

  const alice = backend.activatePrincipal("https://collab.example/team", "Alice");
  assert.equal(alice.settings.gpt.partition, "persist:gpt-chat-profile-existing");

  const bob = backend.activatePrincipal("https://collab.example/team", "Bob");
  assert.match(bob.settings.gpt.partition, new RegExp(bob.principalId));
  assert.notEqual(bob.settings.gpt.partition, alice.settings.gpt.partition);

  patchSettings(
    backend,
    "translation",
    { provider: "offline" },
    bob.settings.settingsRevision,
    bob.principalId,
  );

  const aliceAgain = backend.activatePrincipal("https://collab.example/team", "Alice");
  assert.equal(aliceAgain.settings.gpt.partition, alice.settings.gpt.partition);
});

test("A/B/A keeps each account's AI page location without rewriting the legacy root", (t) => {
  const backend = createBackend(t);
  fs.writeFileSync(
    backend.settingsFile,
    JSON.stringify({
      collab: { server_url: "https://collab.example/team", last_username: "Alice" },
      gpt: {
        partition: "persist:gpt-chat-profile-existing",
        last_url: "https://chatgpt.com/c/alice-legacy",
      },
    }),
  );

  const alice = backend.activatePrincipal("https://collab.example/team", "Alice");
  assert.equal(alice.settings.gpt.last_url, "https://chatgpt.com/c/alice-legacy");
  const aliceSaved = patchSettings(
    backend,
    "gpt",
    { last_url: "https://chatgpt.com/c/alice-current" },
    alice.settings.settingsRevision,
    alice.principalId,
  );

  const bob = backend.activatePrincipal("https://collab.example/team", "Bob");
  assert.equal(bob.settings.gpt.last_url, "https://chatgpt.com/auth/login");
  patchSettings(
    backend,
    "gpt",
    { last_url: "https://chatgpt.com/c/bob-current" },
    bob.settings.settingsRevision,
    bob.principalId,
  );

  assert.equal(
    backend.activatePrincipal("https://collab.example/team", "Alice").settings.gpt.last_url,
    aliceSaved.gpt.last_url,
  );
  assert.equal(
    backend.activatePrincipal("https://collab.example/team", "Bob").settings.gpt.last_url,
    "https://chatgpt.com/c/bob-current",
  );
  assert.equal(
    JSON.parse(fs.readFileSync(backend.settingsFile, "utf8")).gpt.last_url,
    "https://chatgpt.com/c/alice-legacy",
  );
});

test("a different first login cannot overwrite the frozen 1.0.8 partition owner", (t) => {
  const backend = createBackend(t);
  fs.writeFileSync(
    backend.settingsFile,
    JSON.stringify({
      collab: { server_url: "https://collab.example/team", last_username: "Alice" },
      gpt: { partition: "persist:gpt-chat-profile-legacy" },
    }),
  );

  const bob = backend.activatePrincipal("https://collab.example/team", "Bob");
  patchSettings(
    backend,
    "translation",
    { provider: "offline" },
    bob.settings.settingsRevision,
    bob.principalId,
  );
  const alice = backend.activatePrincipal("https://collab.example/team", "Alice");
  assert.equal(alice.settings.gpt.partition, "persist:gpt-chat-profile-legacy");
  assert.notEqual(alice.settings.gpt.partition, bob.settings.gpt.partition);
});

test("disabling advanced AI never removes environments", (t) => {
  const backend = createBackend(t);
  const activated = backend.activatePrincipal("https://collab.example", "Admin");
  const configured = patchSettings(
    backend,
    "advancedAi",
    {
      initialized: true,
      enabled: true,
      environments: [{ id: "durable-env", kind: "claude", name: "Keep", routeId: "route-a" }],
      activeByKind: { gpt: "", gemini: "", claude: "durable-env" },
    },
    activated.settings.settingsRevision,
    activated.principalId,
  );
  const disabled = patchSettings(
    backend,
    "advancedAi",
    { enabled: false },
    configured.settingsRevision,
    activated.principalId,
  );
  assert.equal(disabled.advancedAi.enabled, false);
  assert.equal(disabled.advancedAi.environments[0].id, "durable-env");
  assert.equal(backend.loadSettings().advancedAi.environments[0].id, "durable-env");
});

test("stale principal and revision writes are rejected without changing current data", (t) => {
  const backend = createBackend(t);
  const alice = backend.activatePrincipal("https://collab.example", "Alice");
  const bob = backend.activatePrincipal("https://collab.example", "Bob");
  const before = backend.loadSettings();
  assert.throws(
    () =>
      patchSettings(
        backend,
        "translation",
        { provider: "api" },
        before.settingsRevision,
        alice.principalId,
      ),
    /principal 已变化/,
  );
  const changed = patchSettings(
    backend,
    "translation",
    { provider: "offline" },
    before.settingsRevision,
    bob.principalId,
  );
  assert.throws(
    () =>
      patchSettings(
        backend,
        "translation",
        { provider: "api" },
        before.settingsRevision,
        bob.principalId,
      ),
    /设置已被其他操作更新/,
  );
  assert.equal(backend.loadSettings().translation.provider, changed.translation.provider);
});

test("principal generation changes across A/B/A", (t) => {
  const backend = createBackend(t);
  const alice = backend.activatePrincipal("https://collab.example", "Alice");
  const first = backend.getPrincipalContext();
  backend.activatePrincipal("https://collab.example", "Bob");
  backend.activatePrincipal("https://collab.example", "Alice");
  const second = backend.getPrincipalContext();
  assert.equal(second.principalId, alice.principalId);
  assert.ok(second.generation > first.generation);
  assert.equal(principalId(backend), alice.principalId);
});

test("A/B/A rejects every stale renderer settings write from the first A generation", (t) => {
  const backend = createBackend(t);
  const alice = backend.activatePrincipal("https://collab.example", "Alice");
  const stale = backend.getPrincipalContext();
  backend.activatePrincipal("https://collab.example", "Bob");
  backend.activatePrincipal("https://collab.example", "Alice");
  const current = backend.loadSettings();
  const before = fs.readFileSync(backend.settingsFile, "utf8");

  assert.throws(
    () =>
      saveSettingsForPrincipal(
        backend,
        { ...current, ui: { ...current.ui, theme: "light" } },
        alice.principalId,
        stale.generation,
      ),
    /generation 已变化/,
  );
  assert.throws(
    () =>
      patchSettings(
        backend,
        "translation",
        { provider: "offline" },
        current.settingsRevision,
        alice.principalId,
        stale.generation,
      ),
    /generation 已变化/,
  );
  assert.throws(
    () =>
      operateSettings(
        backend,
        "translation",
        [{ op: "set", path: ["provider"], value: "offline" }],
        current.settingsRevision,
        alice.principalId,
        stale.generation,
      ),
    /generation 已变化/,
  );
  assert.throws(
    () => backend.saveSettingsForPrincipal(current, alice.principalId),
    /generation 已变化/,
  );
  assert.throws(
    () =>
      backend.patchSettings(
        "translation",
        { provider: "offline" },
        current.settingsRevision,
        alice.principalId,
      ),
    /generation 已变化/,
  );
  assert.throws(
    () =>
      backend.operateSettings(
        "translation",
        [{ op: "set", path: ["provider"], value: "offline" }],
        current.settingsRevision,
        alice.principalId,
      ),
    /generation 已变化/,
  );
  assert.equal(fs.readFileSync(backend.settingsFile, "utf8"), before);
});

test("renderer settings writes cannot replace main-owned AI partitions", (t) => {
  const backend = createBackend(t);
  const activated = backend.activatePrincipal("https://collab.example", "Alice");
  const principal = backend.getPrincipalContext();

  assert.throws(
    () =>
      patchSettings(
        backend,
        "gpt",
        { partition: "persist:foreign" },
        activated.settings.settingsRevision,
        principal.principalId,
        principal.generation,
      ),
    /只能由主进程管理/,
  );

  const saved = saveSettingsForPrincipal(
    backend,
    {
      ...activated.settings,
      gpt: { ...activated.settings.gpt, partition: "persist:foreign" },
      advancedAi: {
        ...activated.settings.advancedAi,
        environments: [
          {
            id: "kept-env",
            kind: "gpt",
            name: "Kept",
            routeId: "route-a",
            partition: "persist:foreign-environment",
          },
        ],
      },
    },
    principal.principalId,
    principal.generation,
  );
  assert.equal(saved.gpt.partition, activated.settings.gpt.partition);
  assert.equal("partition" in saved.advancedAi.environments[0], false);

  const partial = saveSettingsForPrincipal(
    backend,
    { settingsRevision: saved.settingsRevision, ui: { theme: "light" } },
    principal.principalId,
    principal.generation,
  );
  assert.equal(partial.gpt.partition, activated.settings.gpt.partition);
  assert.equal(partial.gemini.partition, activated.settings.gemini.partition);
  assert.equal(partial.claude.partition, activated.settings.claude.partition);
  assert.equal(partial.advancedAi.environments[0].id, "kept-env");
});

test("an existing version 2 principal store activates without a migration rewrite", (t) => {
  const backend = createBackend(t);
  const ownerServer = "https://collab.example/team";
  const ownerUsername = "Alice";
  const ownerId = principalIdFor(ownerServer, ownerUsername);
  const stored = JSON.stringify(
    {
      settingsRevision: 9,
      principalSettings: {
        version: 2,
        byPrincipal: {
          [ownerId]: {
            ownerServer,
            ownerUsername,
            advancedAi: {
              version: 1,
              initialized: true,
              enabled: false,
              environments: [{ id: "kept", kind: "gpt", name: "Kept", routeId: "route" }],
              activeByKind: { gpt: "kept", gemini: "", claude: "" },
            },
            translation: { ai: { baseUrl: "http://ai.example", apiKey: "key" } },
          },
        },
        unowned: { legacyRoot: null, legacyByPrincipal: {}, legacyUnowned: null },
        legacyPartitionOwnerId: "",
      },
    },
    null,
    2,
  );
  fs.writeFileSync(backend.settingsFile, stored);
  const activated = backend.activatePrincipal(ownerServer, ownerUsername);
  assert.equal(activated.settings.advancedAi.environments[0].id, "kept");
  assert.equal(fs.readFileSync(backend.settingsFile, "utf8"), stored);
});

test("settings remain v1.0.8-compatible and do not invoke credential encryption", (t) => {
  const backend = createBackend(t);
  const activated = backend.activatePrincipal("https://collab.example", "Alice");
  let saved = patchSettings(
    backend,
    "collab",
    { remember_password: true, saved_password: "remembered-password" },
    activated.settings.settingsRevision,
    activated.principalId,
  );
  patchSettings(
    backend,
    "translation",
    { ai: { baseUrl: "http://ai.example", apiKey: "remembered-api-key" } },
    saved.settingsRevision,
    activated.principalId,
  );

  const raw = fs.readFileSync(backend.settingsFile, "utf8");
  assert.match(raw, /remembered-password/);
  assert.match(raw, /remembered-api-key/);
  assert.doesNotMatch(raw, /sharegpt-safe:/);
});

test("settings imports discard the exported revision before applying current state", () => {
  const imported = {
    settingsRevision: 2,
    principalSettings: { version: 2, byPrincipal: { attacker: {} } },
    gpt: { partition: "persist:foreign-gpt", last_url: "https://chatgpt.com/c/imported" },
    gemini: { partition: "persist:foreign-gemini" },
    claude: { partition: "persist:foreign-claude" },
    advancedAi: {
      environments: [{ id: "imported", kind: "gpt", partition: "persist:foreign-environment" }],
    },
    ui: { theme: "light" },
  };
  assert.deepEqual(prepareImportedSettings(imported), {
    gpt: { last_url: "https://chatgpt.com/c/imported" },
    gemini: {},
    claude: {},
    advancedAi: { environments: [{ id: "imported", kind: "gpt" }] },
    ui: { theme: "light" },
  });
  assert.equal(imported.settingsRevision, 2, "normalization must not mutate the imported object");
  assert.equal(imported.gpt.partition, "persist:foreign-gpt");
  assert.equal(imported.advancedAi.environments[0].partition, "persist:foreign-environment");
});

test("an import preserves current partitions and rejects an A/B/A stale generation", (t) => {
  const backend = createBackend(t);
  const alice = backend.activatePrincipal("https://collab.example", "Alice");
  const imported = {
    settingsRevision: 0,
    principalSettings: { version: 2, byPrincipal: {} },
    gpt: { partition: "persist:foreign-gpt", last_url: "https://chatgpt.com/c/imported" },
    gemini: { partition: "persist:foreign-gemini" },
    claude: { partition: "persist:foreign-claude" },
    advancedAi: {
      enabled: true,
      environments: [{ id: "imported", kind: "gpt", partition: "persist:foreign-environment" }],
      activeByKind: { gpt: "imported", gemini: "", claude: "" },
    },
  };
  const saved = backend.saveImportedSettingsForPrincipal(imported, backend.getPrincipalContext());
  assert.equal(saved.gpt.partition, alice.settings.gpt.partition);
  assert.equal(saved.gemini.partition, alice.settings.gemini.partition);
  assert.equal(saved.claude.partition, alice.settings.claude.partition);
  assert.equal("partition" in saved.advancedAi.environments[0], false);

  const stale = backend.getPrincipalContext();
  backend.activatePrincipal("https://collab.example", "Bob");
  backend.activatePrincipal("https://collab.example", "Alice");
  const before = fs.readFileSync(backend.settingsFile, "utf8");
  assert.throws(
    () => backend.saveImportedSettingsForPrincipal(imported, stale),
    /generation 已变化/,
  );
  assert.equal(fs.readFileSync(backend.settingsFile, "utf8"), before);
});

test("local-device claims a v1.0.8 partition when no collaboration identity exists", (t) => {
  const backend = createBackend(t);
  fs.writeFileSync(
    backend.settingsFile,
    JSON.stringify({
      gpt: {
        partition: "persist:gpt-chat-v1.0.8",
        last_url: "https://chatgpt.com/c/local-session",
      },
      advancedAi: {
        enabled: true,
        environments: [{ id: "local-env", kind: "gpt", routeId: "route-a" }],
        activeByKind: { gpt: "local-env", gemini: "", claude: "" },
      },
    }),
  );

  assert.equal(backend.loadSettings().gpt.partition, "persist:gpt-chat-v1.0.8");
  assert.equal(backend.loadSettings().gpt.last_url, "https://chatgpt.com/c/local-session");
  assert.equal(backend.loadSettings().advancedAi.environments[0].id, "local-env");
  assert.equal(backend.getPrincipalContext().legacyPartitionOwnerId, "local-device");

  const alice = backend.activatePrincipal("https://collab.example", "Alice");
  assert.notEqual(alice.settings.gpt.partition, "persist:gpt-chat-v1.0.8");
  backend.clearPrincipal();
  assert.equal(backend.loadSettings().gpt.partition, "persist:gpt-chat-v1.0.8");
});

test("legacy sharegpt-safe values decrypt in memory and failures never replace the file", (t) => {
  const encrypted = `sharegpt-safe:v1:${Buffer.from("cipher-bytes").toString("base64")}`;
  const raw = JSON.stringify({
    collab: { remember_password: true, saved_password: encrypted },
    translation: { ai: { apiKey: encrypted } },
  });
  const backend = createBackend(t, {
    legacySecretStorage: { decryptString: () => "decrypted-secret" },
  });
  fs.writeFileSync(backend.settingsFile, raw);
  const loaded = backend.loadSettings();
  assert.equal(loaded.collab.saved_password, "decrypted-secret");
  assert.equal(fs.readFileSync(backend.settingsFile, "utf8"), raw);
  backend.activatePrincipal("https://collab.example", "Alice");
  const migratedRaw = fs.readFileSync(backend.settingsFile, "utf8");
  assert.match(migratedRaw, /sharegpt-safe:v1:/);
  assert.doesNotMatch(migratedRaw, /decrypted-secret/);

  assert.deepEqual(
    decodeLegacyEncryptedSettings({ secret: encrypted }, { decryptString: () => "value" }),
    { secret: "value" },
  );
  const failing = createBackend(t, {
    legacySecretStorage: {
      decryptString: () => {
        throw new Error("keychain unavailable");
      },
    },
  });
  fs.writeFileSync(failing.settingsFile, raw);
  assert.throws(() => failing.loadSettings(), /原文件未修改/);
  assert.equal(fs.readFileSync(failing.settingsFile, "utf8"), raw);
});

test("update backup includes every local data store and browser partition", (t) => {
  const backend = createBackend(t);
  const fixtures = {
    "vault-meta.json": { root: "ShareGPT-Vault" },
    "calendar.json": { events: [{ id: "calendar-kept" }] },
    "tasks.json": { tasks: [{ id: "task-kept" }] },
    "focus.json": { sessions: [{ id: "focus-kept" }] },
  };
  const userDataDir = backend.app.getPath("userData");
  for (const [name, payload] of Object.entries(fixtures)) {
    fs.writeFileSync(path.join(userDataDir, name), JSON.stringify(payload));
  }
  fs.mkdirSync(path.join(userDataDir, "ShareGPT-Vault"), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, "ShareGPT-Vault", "kept.md"), "# kept");
  const backup = backend.createUpdateBackup("test");
  for (const [name, payload] of Object.entries(fixtures)) {
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(backup.backupDir, name), "utf8")),
      payload,
    );
  }
  assert.equal(
    fs.readFileSync(path.join(backup.backupDir, "ShareGPT-Vault", "kept.md"), "utf8"),
    "# kept",
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(backup.backupDir, "manifest.json"), "utf8"),
  );
  assert.ok(manifest.entries.includes("vault-meta.json"));
  assert.ok(manifest.entries.includes("ShareGPT-Vault"));
});

test("update restore preserves an existing Chromium partition and reports the conflict", (t) => {
  const backend = createBackend(t);
  const userDataDir = backend.app.getPath("userData");
  const backupDir = path.join(backend.updateBackupsDir, "update-2099-01-01T00-00-00-000Z");
  const sourcePartition = path.join(backupDir, "Partitions", "persist-gpt");
  const targetPartition = path.join(userDataDir, "Partitions", "persist-gpt");
  fs.mkdirSync(sourcePartition, { recursive: true });
  fs.mkdirSync(targetPartition, { recursive: true });
  fs.writeFileSync(path.join(sourcePartition, "Cookies"), "backup-cookie");
  fs.writeFileSync(path.join(targetPartition, "Local State"), "current-state");

  const report = backend.restoreMissingDataFromLatestUpdateBackup();
  assert.equal(fs.existsSync(path.join(targetPartition, "Cookies")), false);
  assert.equal(fs.readFileSync(path.join(targetPartition, "Local State"), "utf8"), "current-state");
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].partition, "persist-gpt");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(userDataDir, "update_restore_report.json"), "utf8"))
      .conflicts,
    report.conflicts,
  );
});
