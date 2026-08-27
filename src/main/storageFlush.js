/**
 * @param {{
 *   fromPartition: (partition: string) => { flushStorageData: () => void | Promise<void> },
 *   timeoutMs?: number,
 *   onWarning?: (partition: string, error: unknown) => void,
 * }} options
 */
function createStorageFlushCoordinator({ fromPartition, timeoutMs = 5000, onWarning }) {
  if (typeof fromPartition !== "function")
    throw new Error("storage partition provider is required");
  const pending = new Set();
  const active = new Set();
  let inFlight = null;

  async function flushOne(partition) {
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(() => fromPartition(partition).flushStorageData()),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`flush timeout: ${partition}`)),
            Math.max(1, Number(timeoutMs) || 5000),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function flush(partitions) {
    for (const partition of partitions || []) {
      const value = String(partition || "").trim();
      if (value && !active.has(value)) pending.add(value);
    }
    if (inFlight) return inFlight;

    const operation = (async () => {
      const errors = [];
      while (pending.size) {
        const batch = [...pending];
        pending.clear();
        for (const partition of batch) active.add(partition);
        await Promise.all(
          batch.map(async (partition) => {
            try {
              await flushOne(partition);
            } catch (error) {
              errors.push(error);
              onWarning?.(partition, error);
            } finally {
              active.delete(partition);
            }
          }),
        );
      }
      if (errors.length) throw new AggregateError(errors, "AI storage flush failed");
    })();
    inFlight = operation;
    void operation.then(
      () => {
        if (inFlight === operation) inFlight = null;
      },
      () => {
        if (inFlight === operation) inFlight = null;
      },
    );
    return operation;
  }

  return { flush };
}

module.exports = { createStorageFlushCoordinator };
