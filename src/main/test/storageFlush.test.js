const assert = require("node:assert/strict");
const test = require("node:test");

const { createStorageFlushCoordinator } = require("../storageFlush");

test("storage flush queues overlapping partitions once", async () => {
  const flushed = [];
  /** @type {(value: string) => void} */
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const coordinator = createStorageFlushCoordinator({
    fromPartition: (partition) => ({
      async flushStorageData() {
        flushed.push(partition);
        if (partition === "a") await gate;
      },
    }),
    timeoutMs: 100,
  });
  const first = coordinator.flush(["a"]);
  const second = coordinator.flush(["a", "b"]);
  assert.strictEqual(first, second);
  release("done");
  await first;
  assert.deepEqual(flushed, ["a", "b"]);
});

test("storage flush rejects a partition that never settles within the bound", async () => {
  const warnings = [];
  const coordinator = createStorageFlushCoordinator({
    fromPartition: () => ({ flushStorageData: () => new Promise(() => {}) }),
    timeoutMs: 5,
    onWarning: (partition) => warnings.push(partition),
  });
  await assert.rejects(coordinator.flush(["stuck"]), /storage flush failed/i);
  assert.deepEqual(warnings, ["stuck"]);
});
