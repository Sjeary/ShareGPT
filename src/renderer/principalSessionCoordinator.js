(function exposePrincipalSessionCoordinator(root, factory) {
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root) {
    Object.defineProperty(root, "ShareGptPrincipalSession", {
      configurable: true,
      value: exported,
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  class StalePrincipalSessionError extends Error {
    constructor() {
      super("新的账号操作已开始，旧操作已取消");
      this.name = "StalePrincipalSessionError";
      this.code = "STALE_PRINCIPAL_SESSION";
    }
  }

  function createPrincipalSessionCoordinator() {
    let latestAttempt = 0;
    let transitionTail = Promise.resolve();

    const assertCurrent = (attempt) => {
      if (attempt !== latestAttempt) throw new StalePrincipalSessionError();
    };

    return {
      begin() {
        latestAttempt += 1;
        return latestAttempt;
      },
      isCurrent(attempt) {
        return attempt === latestAttempt;
      },
      assertCurrent,
      runTransition(attempt, transition) {
        const run = transitionTail
          .catch(() => undefined)
          .then(async () => {
            assertCurrent(attempt);
            const result = await transition();
            assertCurrent(attempt);
            return result;
          });
        transitionTail = run.catch(() => undefined);
        return run;
      },
    };
  }

  return { createPrincipalSessionCoordinator, StalePrincipalSessionError };
});
