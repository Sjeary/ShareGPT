const test = require("node:test");
const assert = require("node:assert/strict");
const { createLegacyAcceptedUsageConsumer } = require("../../renderer/legacyAcceptedUsage");

function acceptedEvent(overrides = {}) {
  return {
    type: "accepted-send",
    kind: "gpt",
    usageId: "usage-123",
    principalId: "principal-a",
    principalGeneration: 4,
    prompt: "must never be forwarded",
    ...overrides,
  };
}

function createHarness(overrides = {}) {
  let principal = { principalId: "principal-a", generation: 4 };
  const reports = [];
  const errors = [];
  const consumer = createLegacyAcceptedUsageConsumer({
    getPrincipal: async () => principal,
    getAuth: () => ({ serverUrl: "https://collab.example/base/", token: "token-a" }),
    report: async (payload) => reports.push(payload),
    delay: async () => undefined,
    onError: (error) => errors.push(error),
    ...overrides,
  });
  return {
    consumer,
    errors,
    reports,
    setPrincipal: (value) => {
      principal = value;
    },
  };
}

test("legacy renderer reports only a main-confirmed accepted send without prompt text", async () => {
  const harness = createHarness();
  assert.equal(await harness.consumer.consume(acceptedEvent()), true);
  assert.deepEqual(harness.reports, [
    {
      serverUrl: "https://collab.example/base",
      token: "token-a",
      usageId: "usage-123",
      principalId: "principal-a",
      principalGeneration: 4,
    },
  ]);
});

test("stale Principal events and malformed acceptance IDs are ignored", async () => {
  const harness = createHarness();
  assert.equal(await harness.consumer.consume(acceptedEvent({ principalGeneration: 3 })), false);
  assert.equal(await harness.consumer.consume(acceptedEvent({ usageId: "bad id" })), false);
  assert.equal(await harness.consumer.consume(acceptedEvent({ type: "console-message" })), false);
  assert.deepEqual(harness.reports, []);
});

test("accepted usage is locally idempotent and retries transient failures", async () => {
  let attempts = 0;
  const reports = [];
  const harness = createHarness({
    report: async (payload) => {
      attempts += 1;
      if (attempts < 3) throw new Error("temporary failure");
      reports.push(payload);
    },
  });
  assert.equal(await harness.consumer.consume(acceptedEvent()), true);
  assert.equal(attempts, 3);
  assert.equal(await harness.consumer.consume(acceptedEvent()), false);
  assert.equal(attempts, 3);
  assert.equal(reports.length, 1);
});

test("a Principal switch stops retries before another request is sent", async () => {
  let attempts = 0;
  let harness;
  harness = createHarness({
    report: async () => {
      attempts += 1;
      harness.setPrincipal({ principalId: "principal-b", generation: 5 });
      throw new Error("temporary failure");
    },
  });
  assert.equal(await harness.consumer.consume(acceptedEvent()), false);
  assert.equal(attempts, 1);
  assert.deepEqual(harness.errors, []);
});
