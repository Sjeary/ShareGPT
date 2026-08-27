const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Backend } = require("../backend");

function createBackend(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-settings-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = {
    isPackaged: true,
    getPath(name) {
      if (name === "exe") return path.join(root, "ShareGPT.exe");
      const target = path.join(root, name);
      fs.mkdirSync(target, { recursive: true });
      return target;
    },
  };
  return new Backend(app, () => null, "all");
}

function activePrincipalId(backend) {
  return backend.getPrincipalContext().principalId;
}

test("settings use an empty remote translation endpoint and reject stale writes", (t) => {
  const backend = createBackend(t);
  const initial = backend.loadSettings();
  assert.equal(initial.translation.ai.baseUrl, "");
  assert.equal(initial.translation.siteLanguage, "en");
  assert.equal(initial.translation.confirmNonTargetSend, true);
  assert.equal(initial.translation.autoTranslateSelection, false);
  assert.equal(initial.settingsRevision, 0);

  const saved = backend.patchSettings("ui", { theme: "dark" }, 0, activePrincipalId(backend));
  assert.equal(saved.settingsRevision, 1);
  assert.equal(saved.ui.theme, "dark");
  assert.throws(
    () => backend.patchSettings("ui", { theme: "light" }, 0, activePrincipalId(backend)),
    /设置已被其他操作更新/,
  );
});

test("settings recover from the atomic backup without overwriting the corrupt file", (t) => {
  const backend = createBackend(t);
  const first = backend.patchSettings("ui", { theme: "dark" }, 0, activePrincipalId(backend));
  backend.patchSettings(
    "ui",
    { sidebarSide: "right" },
    first.settingsRevision,
    activePrincipalId(backend),
  );
  fs.writeFileSync(backend.settingsFile, "{broken", "utf8");

  const recovered = backend.loadSettings();
  assert.equal(recovered.ui.theme, "dark");
  assert.equal(recovered.ui.sidebarSide, undefined);
  assert.equal(fs.readFileSync(backend.settingsFile, "utf8"), "{broken");
});

test("translation settings survive save and reload without overwriting other sections", (t) => {
  const backend = createBackend(t);
  const translated = backend.patchSettings(
    "translation",
    {
      provider: "api",
      sourceLanguage: "en",
      targetLanguage: "zh",
      autoTranslateSelection: true,
      api: { baseUrl: "https://translate.example", apiKey: "test-key" },
    },
    0,
    activePrincipalId(backend),
  );
  const themed = backend.patchSettings(
    "ui",
    { theme: "light", sidebarSide: "right" },
    translated.settingsRevision,
    activePrincipalId(backend),
  );

  const reloaded = backend.loadSettings();
  assert.equal(reloaded.settingsRevision, themed.settingsRevision);
  assert.equal(reloaded.translation.provider, "api");
  assert.equal(reloaded.translation.sourceLanguage, "en");
  assert.equal(reloaded.translation.targetLanguage, "zh");
  assert.equal(reloaded.translation.autoTranslateSelection, true);
  assert.deepEqual(reloaded.translation.api, {
    baseUrl: "https://translate.example",
    apiKey: "test-key",
  });
  assert.equal(reloaded.ui.theme, "light");
  assert.equal(reloaded.ui.sidebarSide, "right");
});

test("legacy notesAi settings migrate only for an exact principal owner", (t) => {
  const backend = createBackend(t);
  fs.mkdirSync(path.dirname(backend.settingsFile), { recursive: true });
  fs.writeFileSync(
    backend.settingsFile,
    JSON.stringify({
      settingsRevision: 4,
      collab: { server_url: "https://collab.example/path", last_username: "Alice" },
      notesAi: {
        baseUrl: "https://ai.example",
        apiKey: "legacy-key",
        model: "legacy-model",
        effort: "high",
      },
    }),
    "utf8",
  );

  const migrated = backend.activatePrincipal("https://collab.example/path", "Alice").settings;
  assert.equal(migrated.settingsRevision, 5);
  assert.deepEqual(migrated.translation.ai, {
    baseUrl: "https://ai.example",
    apiKey: "legacy-key",
    model: "legacy-model",
    effort: "high",
  });
  assert.equal(Object.hasOwn(migrated, "notesAi"), false);
  const stored = JSON.parse(fs.readFileSync(backend.settingsFile, "utf8"));
  const principal = backend.getPrincipalContext();
  assert.equal(stored.principalSettings.version, 2);
  assert.equal(
    stored.principalSettings.byPrincipal[principal.principalId].ownerServer,
    "https://collab.example/path",
  );
  assert.equal(stored.principalSettings.byPrincipal[principal.principalId].ownerUsername, "Alice");
  assert.equal(principal.legacyPartitionOwnerId, principal.principalId);
});

test("advanced AI and translation settings are isolated and persistent per principal", (t) => {
  const backend = createBackend(t);
  const alice = backend.activatePrincipal("https://collab.example", "alice");
  const aliceSaved = backend.patchSettings(
    "advancedAi",
    {
      enabled: true,
      environments: [
        {
          id: "alice-gpt",
          kind: "gpt",
          name: "Alice only",
          routeId: "internal-unified",
          createdAt: "2026-08-26T00:00:00.000Z",
        },
      ],
      activeByKind: { gpt: "alice-gpt", gemini: "", claude: "" },
    },
    alice.settings.settingsRevision,
    alice.principalId,
  );
  backend.patchSettings(
    "translation",
    {
      autoTranslateSelection: true,
      api: { baseUrl: "https://alice.example", apiKey: "alice-secret" },
    },
    aliceSaved.settingsRevision,
    alice.principalId,
  );

  const bob = backend.activatePrincipal("https://collab.example", "bob").settings;
  assert.deepEqual(bob.advancedAi.environments, []);
  assert.equal(bob.translation.api.baseUrl, "");
  assert.equal(bob.translation.api.apiKey, "");
  assert.equal(bob.translation.autoTranslateSelection, false);
  const bobSaved = backend.patchSettings(
    "translation",
    { api: { baseUrl: "https://bob.example", apiKey: "bob-secret" } },
    bob.settingsRevision,
    activePrincipalId(backend),
  );

  const uppercaseAlice = backend.activatePrincipal("https://collab.example", "Alice").settings;
  assert.deepEqual(uppercaseAlice.advancedAi.environments, []);
  assert.equal(uppercaseAlice.translation.api.baseUrl, "");
  assert.equal(uppercaseAlice.translation.autoTranslateSelection, false);
  const otherServerPath = backend.activatePrincipal(
    "https://collab.example/team-a",
    "alice",
  ).settings;
  assert.deepEqual(otherServerPath.advancedAi.environments, []);
  assert.equal(otherServerPath.translation.api.baseUrl, "");
  assert.equal(otherServerPath.translation.autoTranslateSelection, false);

  const aliceAgain = backend.activatePrincipal("https://collab.example", "alice").settings;
  assert.equal(aliceAgain.settingsRevision, bobSaved.settingsRevision);
  assert.deepEqual(
    aliceAgain.advancedAi.environments.map((environment) => environment.id),
    ["alice-gpt"],
  );
  assert.equal(aliceAgain.translation.api.baseUrl, "https://alice.example");
  assert.equal(aliceAgain.translation.api.apiKey, "alice-secret");
  assert.equal(aliceAgain.translation.autoTranslateSelection, true);
  assert.equal(Object.hasOwn(aliceAgain, "principalSettings"), false);
});

test("legacy sensitive settings without a reliable owner stay preserved but unexposed", (t) => {
  const backend = createBackend(t);
  fs.mkdirSync(path.dirname(backend.settingsFile), { recursive: true });
  fs.writeFileSync(
    backend.settingsFile,
    JSON.stringify({
      settingsRevision: 2,
      translation: { api: { baseUrl: "https://unowned.example", apiKey: "unowned-secret" } },
    }),
    "utf8",
  );

  const bob = backend.activatePrincipal("https://collab.example", "bob").settings;
  assert.equal(bob.translation.api.baseUrl, "");
  const stored = JSON.parse(fs.readFileSync(backend.settingsFile, "utf8"));
  assert.equal(
    stored.principalSettings.unowned.legacyUnowned.translation.api.baseUrl,
    "https://unowned.example",
  );
});

test("V1 principal buckets remain archived and cannot be claimed by a colliding V2 identity", (t) => {
  const backend = createBackend(t);
  const legacyPrincipalId = crypto
    .createHash("sha256")
    .update("https://collab.example\0alice", "utf8")
    .digest("hex");
  fs.mkdirSync(path.dirname(backend.settingsFile), { recursive: true });
  fs.writeFileSync(
    backend.settingsFile,
    JSON.stringify({
      settingsRevision: 7,
      collab: { server_url: "https://collab.example", last_username: "Alice" },
      principalSettings: {
        version: 1,
        byPrincipal: {
          [legacyPrincipalId]: {
            advancedAi: { enabled: true, environments: [] },
            translation: {
              api: { baseUrl: "https://legacy-alice.example", apiKey: "legacy-secret" },
            },
          },
        },
        unowned: null,
        legacyPartitionOwnerId: legacyPrincipalId,
      },
    }),
    "utf8",
  );

  const alice = backend.activatePrincipal("https://collab.example", "alice").settings;
  assert.equal(alice.translation.api.baseUrl, "");
  assert.notEqual(backend.getPrincipalContext().principalId, legacyPrincipalId);
  assert.equal(backend.getPrincipalContext().legacyPartitionOwnerId, "");

  const stored = JSON.parse(fs.readFileSync(backend.settingsFile, "utf8"));
  assert.equal(stored.principalSettings.version, 2);
  assert.equal(
    stored.principalSettings.unowned.legacyByPrincipal[legacyPrincipalId].translation.api.baseUrl,
    "https://legacy-alice.example",
  );
  assert.deepEqual(stored.principalSettings.byPrincipal, {});
});

test("an unclaimed root legacy bucket can later be claimed only by its exact owner", (t) => {
  const backend = createBackend(t);
  fs.mkdirSync(path.dirname(backend.settingsFile), { recursive: true });
  fs.writeFileSync(
    backend.settingsFile,
    JSON.stringify({
      settingsRevision: 2,
      collab: { server_url: "https://collab.example/team-a", last_username: "Alice" },
      translation: { api: { baseUrl: "https://alice.example", apiKey: "alice-secret" } },
    }),
    "utf8",
  );

  const wrongPath = backend.activatePrincipal("https://collab.example/team-b", "Alice").settings;
  assert.equal(wrongPath.translation.api.baseUrl, "");
  const wrongCase = backend.activatePrincipal("https://collab.example/team-a", "alice").settings;
  assert.equal(wrongCase.translation.api.baseUrl, "");

  const exact = backend.activatePrincipal("https://collab.example/team-a", "Alice").settings;
  assert.equal(exact.translation.api.baseUrl, "https://alice.example");
  assert.equal(exact.translation.api.apiKey, "alice-secret");
});

test("failed principal migration keeps the previously active principal", (t) => {
  const backend = createBackend(t);
  const alice = backend.activatePrincipal("https://collab.example/team-a", "Alice");
  fs.writeFileSync(
    backend.settingsFile,
    JSON.stringify({
      settingsRevision: alice.settings.settingsRevision,
      collab: { server_url: "https://collab.example/team-b", last_username: "Bob" },
      translation: { api: { baseUrl: "https://bob.example", apiKey: "bob-secret" } },
    }),
    "utf8",
  );
  const renameSync = fs.renameSync;
  fs.renameSync = (source, destination) => {
    if (destination === backend.settingsFile) throw new Error("forced migration failure");
    return renameSync(source, destination);
  };
  try {
    assert.throws(
      () => backend.activatePrincipal("https://collab.example/team-b", "Bob"),
      /forced migration failure/,
    );
  } finally {
    fs.renameSync = renameSync;
  }

  assert.equal(backend.getPrincipalContext().principalId, alice.principalId);
});

test("failed principal clear restores the previous principal", (t) => {
  const backend = createBackend(t);
  const alice = backend.activatePrincipal("https://collab.example", "Alice");
  const aliceGeneration = backend.getPrincipalContext().generation;
  const loadSettings = backend.loadSettings;
  backend.loadSettings = () => {
    throw new Error("forced clear failure");
  };
  assert.throws(() => backend.clearPrincipal(), /forced clear failure/);
  backend.loadSettings = loadSettings;
  assert.equal(backend.getPrincipalContext().principalId, alice.principalId);
  assert.equal(backend.getPrincipalContext().generation, aliceGeneration);
});

test("principal generation rejects A/B/A async contexts even when the id matches again", (t) => {
  const backend = createBackend(t);
  const alice = backend.activatePrincipal("https://collab.example/team-a", "Alice");
  const firstAliceContext = backend.getPrincipalContext();

  backend.activatePrincipal("https://collab.example/team-a", "Bob");
  const secondAlice = backend.activatePrincipal("https://collab.example/team-a", "Alice");
  const secondAliceContext = backend.getPrincipalContext();

  assert.equal(secondAlice.principalId, alice.principalId);
  assert.equal(secondAliceContext.principalId, firstAliceContext.principalId);
  assert.ok(secondAliceContext.generation > firstAliceContext.generation);
});

test("settings writes reject a stale expected principal after an account switch", (t) => {
  const backend = createBackend(t);
  const alice = backend.activatePrincipal("https://collab.example", "Alice");
  const bob = backend.activatePrincipal("https://collab.example", "Bob");
  const before = backend.loadSettings();

  assert.throws(
    () =>
      backend.patchSettings(
        "sender",
        { proxy_server: "alice-only" },
        before.settingsRevision,
        alice.principalId,
      ),
    /principal 已变化/,
  );
  assert.throws(
    () => backend.saveSettingsForPrincipal(before, alice.principalId),
    /principal 已变化/,
  );
  assert.throws(
    () =>
      backend.operateSettings(
        "translation",
        [{ op: "set", path: ["api", "apiKey"], value: "alice-secret" }],
        before.settingsRevision,
        alice.principalId,
      ),
    /principal 已变化/,
  );
  assert.throws(
    () =>
      backend.operateSettings(
        "advancedAi",
        [{ op: "set", path: ["enabled"], value: true }],
        before.settingsRevision,
        alice.principalId,
      ),
    /principal 已变化/,
  );
  assert.throws(
    () =>
      backend.patchSettings(
        "sender",
        { proxy_server: "missing-principal" },
        before.settingsRevision,
      ),
    /principal 已变化/,
  );
  assert.throws(
    () =>
      backend.operateSettings(
        "translation",
        [{ op: "set", path: ["api", "apiKey"], value: "missing-principal" }],
        before.settingsRevision,
      ),
    /principal 已变化/,
  );
  assert.equal(backend.getPrincipalContext().principalId, bob.principalId);
  assert.deepEqual(backend.loadSettings(), before);
});

test("same-section nested operations survive a revision conflict without lost updates", (t) => {
  const backend = createBackend(t);
  const activated = backend.activatePrincipal("https://collab.example", "alice").settings;
  const seeded = backend.operateSettings(
    "advancedAi",
    [
      {
        op: "set",
        path: ["environments", "env-one"],
        value: {
          id: "env-one",
          kind: "gpt",
          name: "Original",
          routeId: "route-one",
          createdAt: "2026-08-26T00:00:00.000Z",
        },
      },
    ],
    activated.settingsRevision,
    activePrincipalId(backend),
  );
  const renamed = backend.operateSettings(
    "advancedAi",
    [{ op: "set", path: ["environments", "env-one", "name"], value: "Renamed" }],
    seeded.settingsRevision,
    activePrincipalId(backend),
  );
  assert.throws(
    () =>
      backend.operateSettings(
        "advancedAi",
        [{ op: "set", path: ["environments", "env-one", "routeId"], value: "route-two" }],
        seeded.settingsRevision,
        activePrincipalId(backend),
      ),
    /设置已被其他操作更新/,
  );
  const routed = backend.operateSettings(
    "advancedAi",
    [{ op: "set", path: ["environments", "env-one", "routeId"], value: "route-two" }],
    renamed.settingsRevision,
    activePrincipalId(backend),
  );
  assert.deepEqual(routed.advancedAi.environments[0], {
    id: "env-one",
    kind: "gpt",
    name: "Renamed",
    routeId: "route-two",
    createdAt: "2026-08-26T00:00:00.000Z",
  });
});

test("translation provider fields update independently and malicious paths are rejected", (t) => {
  const backend = createBackend(t);
  const first = backend.operateSettings(
    "translation",
    [{ op: "set", path: ["api", "baseUrl"], value: "https://translate.example" }],
    0,
    activePrincipalId(backend),
  );
  const second = backend.operateSettings(
    "translation",
    [{ op: "set", path: ["api", "apiKey"], value: "secret" }],
    first.settingsRevision,
    activePrincipalId(backend),
  );
  assert.equal(second.translation.api.baseUrl, "https://translate.example");
  assert.equal(second.translation.api.apiKey, "secret");
  for (const path of [["__proto__"], ["api", "constructor"], ["api", "unknown"]]) {
    assert.throws(
      () =>
        backend.operateSettings(
          "translation",
          [{ op: "set", path, value: "x" }],
          second.settingsRevision,
          activePrincipalId(backend),
        ),
      /路径/,
    );
  }
});

test("translation behavior operations are normalized as booleans", (t) => {
  const backend = createBackend(t);
  const saved = backend.operateSettings(
    "translation",
    [
      { op: "set", path: ["siteLanguage"], value: "ja" },
      { op: "set", path: ["confirmNonTargetSend"], value: "false" },
      { op: "set", path: ["autoTranslateSelection"], value: "true" },
    ],
    0,
    activePrincipalId(backend),
  );

  assert.equal(saved.translation.siteLanguage, "ja");
  assert.equal(saved.translation.confirmNonTargetSend, true);
  assert.equal(saved.translation.autoTranslateSelection, false);

  const enabled = backend.operateSettings(
    "translation",
    [
      { op: "set", path: ["confirmNonTargetSend"], value: false },
      { op: "set", path: ["autoTranslateSelection"], value: true },
    ],
    saved.settingsRevision,
    activePrincipalId(backend),
  );
  assert.equal(enabled.translation.confirmNonTargetSend, false);
  assert.equal(enabled.translation.autoTranslateSelection, true);
});
