const test = require("node:test");
const assert = require("node:assert/strict");
const { createAiEnvironmentGenerationGuard } = require("../aiEnvironmentGeneration");

function deferred() {
  /** @type {(value?: unknown) => void} */
  let resolve = () => {};
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a stale ensure cannot perform a main-process side effect after switching environments", async () => {
  const guard = createAiEnvironmentGenerationGuard();
  const health = deferred();
  const sideEffects = [];
  const operationA = guard.activate({ kind: "gpt", environmentId: "env-a", generation: 1 });
  const ensureA = (async () => {
    await health.promise;
    guard.assert(operationA);
    sideEffects.push("create-workspace-a");
  })();

  guard.activate({ kind: "gpt", environmentId: "env-b", generation: 2 });
  health.resolve();
  await assert.rejects(ensureA, (error) =>
    Boolean(
      error &&
      typeof error === "object" &&
      /** @type {{code?: string}} */ (error).code === "AI_ENVIRONMENT_STALE",
    ),
  );
  assert.deepEqual(sideEffects, []);
});

test("principal invalidation rejects every previously issued operation", () => {
  const guard = createAiEnvironmentGenerationGuard();
  const operation = guard.activate({ kind: "claude", environmentId: "env-a", generation: 4 });
  guard.invalidateAll();
  assert.throws(() => guard.assert(operation), /已失效/);
  assert.throws(
    () => guard.activate({ kind: "gpt", environmentId: "__proto__", generation: 1 }),
    /标识不合法/,
  );
});
