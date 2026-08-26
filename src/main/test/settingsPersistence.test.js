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

test("settings use an empty remote translation endpoint and reject stale writes", (t) => {
  const backend = createBackend(t);
  const initial = backend.loadSettings();
  assert.equal(initial.translation.ai.baseUrl, "");
  assert.equal(initial.translation.siteLanguage, "en");
  assert.equal(initial.translation.confirmNonTargetSend, true);
  assert.equal(initial.settingsRevision, 0);

  const saved = backend.patchSettings("ui", { theme: "dark" }, 0);
  assert.equal(saved.settingsRevision, 1);
  assert.equal(saved.ui.theme, "dark");
  assert.throws(() => backend.patchSettings("ui", { theme: "light" }, 0), /设置已被其他操作更新/);
});

test("settings recover from the atomic backup without overwriting the corrupt file", (t) => {
  const backend = createBackend(t);
  const first = backend.patchSettings("ui", { theme: "dark" }, 0);
  backend.patchSettings("ui", { sidebarSide: "right" }, first.settingsRevision);
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
      api: { baseUrl: "https://translate.example", apiKey: "test-key" },
    },
    0,
  );
  const themed = backend.patchSettings(
    "ui",
    { theme: "light", sidebarSide: "right" },
    translated.settingsRevision,
  );

  const reloaded = backend.loadSettings();
  assert.equal(reloaded.settingsRevision, themed.settingsRevision);
  assert.equal(reloaded.translation.provider, "api");
  assert.equal(reloaded.translation.sourceLanguage, "en");
  assert.equal(reloaded.translation.targetLanguage, "zh");
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
  );
  backend.patchSettings(
    "translation",
    { api: { baseUrl: "https://alice.example", apiKey: "alice-secret" } },
    aliceSaved.settingsRevision,
  );

  const bob = backend.activatePrincipal("https://collab.example", "bob").settings;
  assert.deepEqual(bob.advancedAi.environments, []);
  assert.equal(bob.translation.api.baseUrl, "");
  assert.equal(bob.translation.api.apiKey, "");
  const bobSaved = backend.patchSettings(
    "translation",
    { api: { baseUrl: "https://bob.example", apiKey: "bob-secret" } },
    bob.settingsRevision,
  );

  const uppercaseAlice = backend.activatePrincipal("https://collab.example", "Alice").settings;
  assert.deepEqual(uppercaseAlice.advancedAi.environments, []);
  assert.equal(uppercaseAlice.translation.api.baseUrl, "");
  const otherServerPath = backend.activatePrincipal(
    "https://collab.example/team-a",
    "alice",
  ).settings;
  assert.deepEqual(otherServerPath.advancedAi.environments, []);
  assert.equal(otherServerPath.translation.api.baseUrl, "");

  const aliceAgain = backend.activatePrincipal("https://collab.example", "alice").settings;
  assert.equal(aliceAgain.settingsRevision, bobSaved.settingsRevision);
  assert.deepEqual(
    aliceAgain.advancedAi.environments.map((environment) => environment.id),
    ["alice-gpt"],
  );
  assert.equal(aliceAgain.translation.api.baseUrl, "https://alice.example");
  assert.equal(aliceAgain.translation.api.apiKey, "alice-secret");
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
  );
  const renamed = backend.operateSettings(
    "advancedAi",
    [{ op: "set", path: ["environments", "env-one", "name"], value: "Renamed" }],
    seeded.settingsRevision,
  );
  assert.throws(
    () =>
      backend.operateSettings(
        "advancedAi",
        [{ op: "set", path: ["environments", "env-one", "routeId"], value: "route-two" }],
        seeded.settingsRevision,
      ),
    /设置已被其他操作更新/,
  );
  const routed = backend.operateSettings(
    "advancedAi",
    [{ op: "set", path: ["environments", "env-one", "routeId"], value: "route-two" }],
    renamed.settingsRevision,
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
  );
  const second = backend.operateSettings(
    "translation",
    [{ op: "set", path: ["api", "apiKey"], value: "secret" }],
    first.settingsRevision,
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
        ),
      /路径/,
    );
  }
});
