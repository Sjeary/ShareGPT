(function exposeLegacyAcceptedUsage(root, factory) {
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root) {
    Object.defineProperty(root, "ShareGptLegacyAcceptedUsage", {
      configurable: true,
      value: exported,
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const USAGE_ID_PATTERN = /^[a-z0-9-]{3,80}$/i;

  function normalizePrincipal(value) {
    const principalId = String(value?.principalId || "").trim();
    const generation = Number(value?.generation ?? value?.principalGeneration);
    if (!principalId || !Number.isInteger(generation) || generation < 0) return null;
    return { principalId, generation };
  }

  function principalMatches(expected, current) {
    return Boolean(
      expected &&
      current &&
      expected.principalId === current.principalId &&
      expected.generation === current.generation,
    );
  }

  function createLegacyAcceptedUsageConsumer(options = {}) {
    const getPrincipal = options.getPrincipal;
    const getAuth = options.getAuth;
    const report = options.report;
    const delay =
      options.delay ||
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const now = options.now || Date.now;
    const onError = options.onError || (() => undefined);
    const accepted = new Map();
    const pending = new Map();

    if (
      typeof getPrincipal !== "function" ||
      typeof getAuth !== "function" ||
      typeof report !== "function"
    ) {
      throw new TypeError("legacy accepted usage consumer dependencies are required");
    }

    async function currentPrincipalMatches(expected) {
      return principalMatches(expected, normalizePrincipal(await getPrincipal()));
    }

    async function consume(payload) {
      if (
        String(payload?.type || "") !== "accepted-send" ||
        String(payload?.kind || "") !== "gpt"
      ) {
        return false;
      }
      const usageId = String(payload?.usageId || "").trim();
      const expectedPrincipal = normalizePrincipal({
        principalId: payload?.principalId,
        generation: payload?.principalGeneration,
      });
      if (!USAGE_ID_PATTERN.test(usageId) || !expectedPrincipal) return false;
      if (!(await currentPrincipalMatches(expectedPrincipal))) return false;

      const auth = getAuth() || {};
      const serverUrl = String(auth.serverUrl || "")
        .trim()
        .replace(/\/+$/, "");
      const token = String(auth.token || "");
      if (!serverUrl || !token) return false;

      const key = `${expectedPrincipal.principalId}:gpt:${usageId}`;
      const currentTime = now();
      for (const [knownKey, expiresAt] of accepted) {
        if (expiresAt <= currentTime) accepted.delete(knownKey);
      }
      if (accepted.has(key) || pending.has(key)) return false;

      const operation = (async () => {
        let lastError;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (!(await currentPrincipalMatches(expectedPrincipal))) return false;
          try {
            await report({
              serverUrl,
              token,
              usageId,
              principalId: expectedPrincipal.principalId,
              principalGeneration: expectedPrincipal.generation,
            });
            accepted.set(key, now() + 60_000);
            return true;
          } catch (error) {
            lastError = error;
            if (error?.retryable === false || attempt === 2) throw error;
          }
          await delay(100 * (attempt + 1));
        }
        throw lastError;
      })();
      pending.set(key, operation);
      try {
        return await operation;
      } catch (error) {
        onError(error);
        return false;
      } finally {
        pending.delete(key);
      }
    }

    return { consume };
  }

  return { createLegacyAcceptedUsageConsumer };
});
