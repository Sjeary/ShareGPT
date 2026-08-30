const test = require("node:test");
const assert = require("node:assert/strict");
const { createPrincipalSessionCoordinator } = require("../../renderer/principalSessionCoordinator");

function deferred() {
  /** @type {(value?: unknown) => void} */
  let resolve = () => undefined;
  const promise = new Promise((done) => {
    resolve = (value) => done(value);
  });
  return { promise, resolve };
}

test("legacy Principal transitions are serialized and a queued stale login never activates", async () => {
  const coordinator = createPrincipalSessionCoordinator();
  const firstAttempt = coordinator.begin();
  const firstStarted = deferred();
  const firstTransition = deferred();
  const activated = [];
  const first = coordinator.runTransition(firstAttempt, async () => {
    activated.push("Alice");
    firstStarted.resolve();
    await firstTransition.promise;
    return "Alice";
  });

  await firstStarted.promise;
  const secondAttempt = coordinator.begin();
  const staleQueued = coordinator.runTransition(firstAttempt, async () => {
    activated.push("stale");
    return "stale";
  });
  const second = coordinator.runTransition(secondAttempt, async () => {
    activated.push("Bob");
    return "Bob";
  });

  firstTransition.resolve();
  await assert.rejects(first, { code: "STALE_PRINCIPAL_SESSION" });
  await assert.rejects(staleQueued, { code: "STALE_PRINCIPAL_SESSION" });
  assert.equal(await second, "Bob");
  assert.deepEqual(activated, ["Alice", "Bob"]);
});

test("a logout invalidated by a newer login cannot clear that newer Principal", async () => {
  const coordinator = createPrincipalSessionCoordinator();
  const logoutAttempt = coordinator.begin();
  const loginAttempt = coordinator.begin();
  let cleared = false;

  await assert.rejects(
    coordinator.runTransition(logoutAttempt, async () => {
      cleared = true;
    }),
    { code: "STALE_PRINCIPAL_SESSION" },
  );
  assert.equal(cleared, false);
  assert.equal(await coordinator.runTransition(loginAttempt, async () => "current"), "current");
});
