const { readLocalJson, writeLocalJson } = require("./localJsonStore");
const { normalizePrincipalId } = require("./principal");
const { normalizeAiEnvironmentId, partitionForAiEnvironment } = require("./aiEnvironments");

function validRecord(record) {
  if (!record || !["gpt", "gemini", "claude"].includes(record.kind)) return false;
  const principalId = normalizePrincipalId(record.principalId, { allowLocal: true });
  const environmentId = normalizeAiEnvironmentId(record.environmentId);
  if (
    !principalId ||
    principalId !== record.principalId ||
    !environmentId ||
    environmentId !== record.environmentId
  )
    return false;
  return [
    partitionForAiEnvironment(record.kind, environmentId, { principalId }),
    partitionForAiEnvironment(record.kind, environmentId, {
      principalId,
      legacyPartitionOwnerId: principalId,
    }),
  ].includes(record.partition);
}

function validStore(value) {
  return value?.version === 1 && Array.isArray(value.pending) && value.pending.every(validRecord);
}

// This is a durable record of an already confirmed deletion, never a new request to delete
// arbitrary browser data. The exact original partition is retained across retries/upgrades.
function createAiEnvironmentCleanup({ file, clearPartition, canClear }) {
  const inFlight = new Map();
  const read = () => readLocalJson(file, { version: 1, pending: [] }, validStore);
  const write = (pending) => writeLocalJson(file, { version: 1, pending }, validStore);
  const key = (record) => `${record.principalId}:${record.partition}`;

  function enqueue(record) {
    if (!validRecord(record)) throw new Error("无效的环境清理记录");
    const current = read().pending;
    if (!current.some((entry) => key(entry) === key(record))) {
      write([...current, { ...record, requestedAt: new Date().toISOString() }]);
    }
  }

  function retryOne(record) {
    const id = key(record);
    if (inFlight.has(id)) return inFlight.get(id);
    const operation = (async () => {
      try {
        if (!canClear(record)) return false;
        await clearPartition(record.partition);
        write(read().pending.filter((entry) => key(entry) !== id));
        return true;
      } catch {
        return false;
      }
    })().finally(() => inFlight.delete(id));
    inFlight.set(id, operation);
    return operation;
  }

  return {
    enqueue,
    list(principalId) {
      return read().pending.filter(
        (record) => record.principalId === principalId && canClear(record),
      );
    },
    async retry(principalId, kind = "") {
      const pending = read().pending.filter(
        (record) => record.principalId === principalId && (!kind || record.kind === kind),
      );
      const results = await Promise.all(pending.map(retryOne));
      return { cleared: results.filter(Boolean).length, pending: this.list(principalId) };
    },
  };
}

module.exports = { createAiEnvironmentCleanup };
