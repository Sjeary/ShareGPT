const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAiEnvironmentCleanup } = require("../aiEnvironmentCleanup");
const { principalIdFor } = require("../principal");
const { partitionForAiEnvironment } = require("../aiEnvironments");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-cleanup-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const principalId = principalIdFor("https://team.example", "Alice");
  const record = {
    principalId,
    kind: "gpt",
    environmentId: "original",
    partition: partitionForAiEnvironment("gpt", "original", {
      principalId,
      legacyPartitionOwnerId: principalId,
    }),
  };
  return { file: path.join(dir, "cleanup.json"), record };
}

test("failed cleanup survives restart and retries the original legacy partition only", async (t) => {
  const { file, record } = fixture(t);
  const failed = createAiEnvironmentCleanup({
    file,
    canClear: () => true,
    clearPartition: async () => {
      throw new Error("locked cache");
    },
  });
  failed.enqueue(record);
  assert.equal((await failed.retry(record.principalId)).pending.length, 1);
  const cleared = [];
  const reopened = createAiEnvironmentCleanup({
    file,
    canClear: () => true,
    clearPartition: async (partition) => {
      cleared.push(partition);
    },
  });
  assert.equal((await reopened.retry(record.principalId)).cleared, 1);
  assert.deepEqual(cleared, [record.partition]);
  assert.deepEqual(reopened.list(record.principalId), []);
});

test("a staged delete with existing configuration never clears its live environment", async (t) => {
  const { file, record } = fixture(t);
  let calls = 0;
  let configured = true;
  const cleanup = createAiEnvironmentCleanup({
    file,
    canClear: () => !configured,
    clearPartition: async () => {
      calls++;
    },
  });
  cleanup.enqueue(record);
  assert.equal((await cleanup.retry(record.principalId)).cleared, 0);
  assert.equal(calls, 0);
  configured = false;
  await cleanup.retry(record.principalId);
  assert.equal(calls, 1);
});

test("parallel retries share one cleanup and another Principal cannot trigger it", async (t) => {
  const { file, record } = fixture(t);
  let calls = 0;
  let release = () => {};
  const cleanup = createAiEnvironmentCleanup({
    file,
    canClear: () => true,
    clearPartition: async () => {
      calls++;
      await new Promise((resolve) => {
        release = () => resolve(undefined);
      });
    },
  });
  cleanup.enqueue(record);
  await cleanup.retry("local-device");
  assert.equal(calls, 0);
  const first = cleanup.retry(record.principalId);
  const second = cleanup.retry(record.principalId);
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(cleanup.list(record.principalId), []);
});

test("cleanup rejects arbitrary partitions and preserves a corrupt ledger", (t) => {
  const { file, record } = fixture(t);
  const cleanup = createAiEnvironmentCleanup({
    file,
    canClear: () => true,
    clearPartition: async () => {},
  });
  assert.throws(() => cleanup.enqueue({ ...record, partition: "persist:gpt-chat" }));
  fs.writeFileSync(file, "{broken");
  assert.throws(() => cleanup.enqueue(record));
  assert.equal(fs.readFileSync(file, "utf8"), "{broken");
});
