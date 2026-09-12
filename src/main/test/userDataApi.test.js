const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
test("data wrapper preserves optional blank-note content and rejects retired reads", async () => {
  let generation = 1;
  const calls = [];
  const runtime = {
    snapshot: () => ({ principalId: "A", generation }),
    assertCurrent: (s) => {
      if (s.generation !== generation) throw new Error("stale");
    },
  };
  const source = fs.readFileSync(
    path.join(__dirname, "../../renderer-next/src/lib/userDataApi.ts"),
    "utf8",
  );
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: 1, target: 9 } }).outputText,
    { exports, require: () => ({ settingsPrincipalRuntime: runtime }) },
  );
  let resolveRead = (_value) => {};
  const bridge = {
    vault: { create: async (...args) => calls.push(args) },
    loadTasks: () =>
      new Promise((r) => {
        resolveRead = r;
      }),
  };
  const api = exports.scopedUserDataApi(bridge);
  await api.vault.create("blank.md");
  await api.vault.create("text.md", "body");
  assert.deepEqual(calls, [
    ["blank.md", "", { principalId: "A", generation: 1 }],
    ["text.md", "body", { principalId: "A", generation: 1 }],
  ]);
  const pending = api.loadTasks();
  generation++;
  resolveRead({ tasks: ["A"] });
  await assert.rejects(pending, /stale/);
});
