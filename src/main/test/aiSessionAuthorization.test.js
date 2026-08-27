const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createAuthorizationEpochGuard,
  fetchAuthenticatedJson,
  readBoundedResponseText,
  resolveAiSessionCapability,
} = require("../aiSessionAuthorization");

test("authorization epochs reject stale A/B/A completions and preserve the latest request", () => {
  const guard = createAuthorizationEpochGuard();
  const firstA = guard.advance();
  const b = guard.advance();
  const secondA = guard.advance();
  assert.equal(guard.isCurrent(firstA), false);
  assert.equal(guard.isCurrent(b), false);
  assert.equal(guard.isCurrent(secondA), true);
  assert.throws(() => guard.assert(firstA), { code: "AI_AUTHORIZATION_STALE" });
  assert.doesNotThrow(() => guard.assert(secondA));
});

test("new bootstrap authorization preserves only explicit account capabilities", () => {
  assert.deepEqual(
    resolveAiSessionCapability(
      {
        authorization: {
          username: "Alice",
          isAdmin: false,
          advancedAiAllowed: true,
          allowedProxyRouteIds: ["route-us"],
        },
      },
      null,
      "Alice",
    ),
    {
      legacy: false,
      username: "Alice",
      isAdmin: false,
      advancedAiAllowed: true,
      allowedProxyRouteIds: ["route-us"],
    },
  );
});

test("legacy bootstrap uses an exact profile match and fails privileged access closed", () => {
  assert.deepEqual(resolveAiSessionCapability({}, { profile: { username: "Alice" } }, "Alice"), {
    legacy: true,
    username: "Alice",
    isAdmin: false,
    advancedAiAllowed: false,
    allowedProxyRouteIds: [],
  });
  assert.throws(
    () => resolveAiSessionCapability({}, { profile: { username: "alice" } }, "Alice"),
    /未返回匹配的账号信息/,
  );
});

test("new bootstrap username mismatch cannot fall back to a legacy profile", () => {
  assert.throws(
    () =>
      resolveAiSessionCapability(
        { authorization: { username: "Mallory" } },
        { profile: { username: "Alice" } },
        "Alice",
      ),
    /未返回匹配的账号授权/,
  );
});

test("bounded response reader rejects oversized streamed responses before completion", async () => {
  let cancelled = false;
  const chunks = [Buffer.alloc(4), Buffer.alloc(5)];
  const response = {
    body: {
      getReader: () => ({
        async read() {
          return chunks.length ? { done: false, value: chunks.shift() } : { done: true };
        },
        async cancel() {
          cancelled = true;
        },
      }),
    },
  };
  await assert.rejects(readBoundedResponseText(response, 8), /响应过大/);
  assert.equal(cancelled, true);
});

test("authenticated JSON fetch binds the bearer token and rejects malformed JSON", async () => {
  const requests = [];
  await assert.rejects(
    fetchAuthenticatedJson(
      async (url, options) => {
        requests.push({ url, options });
        return { ok: true, status: 200, body: null, text: async () => "not-json" };
      },
      "https://server.example/api/client/bootstrap",
      "session-token",
    ),
    /响应无效/,
  );
  const request = requests[0];
  if (!request) throw new Error("request was not captured");
  assert.equal(request.url, "https://server.example/api/client/bootstrap");
  assert.equal(request.options.headers.Authorization, "Bearer session-token");
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.signal instanceof AbortSignal, true);
});

test("authenticated JSON fetch aborts a stalled authorization request", async () => {
  await assert.rejects(
    fetchAuthenticatedJson(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(options.signal.reason), {
            once: true,
          });
        }),
      "https://server.example/api/profile",
      "session-token",
      { timeoutMs: 5 },
    ),
    /请求超时/,
  );
});
