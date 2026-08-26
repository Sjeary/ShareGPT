const AI_KINDS = new Set(["gpt", "gemini", "claude"]);
const ENVIRONMENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

function normalizeOperation(payload) {
  const kind = String(payload?.kind || "").trim();
  if (!AI_KINDS.has(kind)) throw new Error("不支持的 AI 服务");
  const rawEnvironmentId = String(payload?.environmentId || "")
    .trim()
    .toLowerCase();
  if (rawEnvironmentId && !ENVIRONMENT_ID_PATTERN.test(rawEnvironmentId)) {
    throw new Error("AI 环境标识不合法");
  }
  const generation = Number.parseInt(String(payload?.generation || "0"), 10);
  if (!Number.isInteger(generation) || generation < 1) throw new Error("环境切换请求已失效");
  return { kind, environmentId: rawEnvironmentId, generation };
}

function createAiEnvironmentGenerationGuard() {
  const state = {
    gpt: { environmentId: "", generation: 0 },
    gemini: { environmentId: "", generation: 0 },
    claude: { environmentId: "", generation: 0 },
  };
  return {
    activate(payload) {
      const operation = normalizeOperation(payload);
      const current = state[operation.kind];
      if (
        operation.generation < current.generation ||
        (operation.generation === current.generation &&
          operation.environmentId !== current.environmentId)
      ) {
        return { ...operation, stale: true };
      }
      state[operation.kind] = {
        environmentId: operation.environmentId,
        generation: operation.generation,
      };
      return { ...operation, stale: false };
    },
    assert(payload) {
      const operation = normalizeOperation(payload);
      const current = state[operation.kind];
      if (
        operation.generation !== current.generation ||
        operation.environmentId !== current.environmentId
      ) {
        throw Object.assign(new Error("AI 环境操作已失效"), { code: "AI_ENVIRONMENT_STALE" });
      }
      return operation;
    },
    isCurrent(operation) {
      try {
        this.assert(operation);
        return true;
      } catch {
        return false;
      }
    },
    invalidateAll() {
      for (const kind of AI_KINDS) {
        state[kind] = { environmentId: "", generation: 0 };
      }
    },
  };
}

module.exports = { createAiEnvironmentGenerationGuard, normalizeOperation };
