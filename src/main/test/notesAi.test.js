const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createPinnedLookup } = require("../endpointSecurity");
const { buildTranslationPrompt, createNotesAi } = require("../notesAi");

test("translation prompts preserve structured content and apply quality settings", () => {
  const prompt = buildTranslationPrompt("请查看 `value` 和 https://example.test/@Alice", {
    targetLanguage: "English",
    translationStyle: "concise",
    glossary: "ShareGPT = ShareGPT\n工作区 = workspace",
  });
  assert.match(prompt, /目标语言：English/);
  assert.match(prompt, /简洁、直接/);
  assert.match(prompt, /代码块、行内代码、URL、文件路径、变量名、占位符和 @mention 原样保留/);
  assert.match(prompt, /ShareGPT = ShareGPT/);
  assert.match(prompt, /<待翻译原文>[\s\S]*`value`[\s\S]*https:\/\/example\.test\/@Alice/);
});

test("translation prompts reject unknown styles and bound glossary input", () => {
  const prompt = buildTranslationPrompt("source", {
    targetLanguage: "中文",
    translationStyle: "invented",
    glossary: "x".repeat(5000),
  });
  assert.match(prompt, /自然、准确/);
  assert.ok(prompt.length < 4400);
});

function waitForTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function responseRequest(chunks, statusCode = 200) {
  return (_options, callback) => {
    const request = /** @type {any} */ (new EventEmitter());
    request.destroy = () => {};
    request.end = () => {
      const response = /** @type {any} */ (new PassThrough());
      response.statusCode = statusCode;
      callback(response);
      for (const chunk of chunks) response.write(chunk);
      response.end();
    };
    return request;
  };
}

function manualTimeouts(t) {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let nextId = 0;
  const callbacks = new Map();
  globalThis.setTimeout = /** @type {any} */ (
    (callback) => {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    }
  );
  globalThis.clearTimeout = /** @type {any} */ ((id) => callbacks.delete(id));
  t.after(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });
  return {
    get size() {
      return callbacks.size;
    },
    runNext() {
      const entry = callbacks.entries().next().value;
      if (!entry) throw new Error("no pending timeout");
      const [id, callback] = entry;
      callbacks.delete(id);
      callback();
    },
  };
}

function createHarness(options = {}) {
  const events = [];
  const notesAi = createNotesAi({
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        send: (_channel, payload) => events.push(payload),
      },
    }),
    lookup: options.lookup || (async () => [{ address: "93.184.216.34", family: 4 }]),
    httpsRequest: options.httpsRequest || responseRequest([]),
  });
  return { notesAi, events };
}

test("notes AI completed event emits one terminal done", async () => {
  const { notesAi, events } = createHarness({
    httpsRequest: responseRequest([
      'data: {"type":"response.output_text.delta","delta":"完成"}\n',
      'data: {"type":"response.completed"}\n',
    ]),
  });
  notesAi.complete({
    provider: { baseUrl: "https://example.test", apiKey: "test", model: "test" },
    mode: "summary",
    text: "内容",
  });
  await waitForTurn();
  assert.equal(events.filter((event) => event.type === "delta").length, 1);
  assert.equal(events.filter((event) => event.type === "done").length, 1);
  assert.equal(events.filter((event) => event.type === "error").length, 0);
});

test("notes AI failed event is not followed by done", async () => {
  const { notesAi, events } = createHarness({
    httpsRequest: responseRequest([
      'data: {"type":"response.failed","error":{"message":"拒绝"}}\n',
    ]),
  });
  notesAi.complete({
    provider: { baseUrl: "https://example.test", apiKey: "test", model: "test" },
    mode: "summary",
    text: "内容",
  });
  await waitForTurn();
  assert.equal(events.filter((event) => event.type === "error").length, 1);
  assert.equal(events.filter((event) => event.type === "done").length, 0);
});

test("notes AI handles an SSE terminal line without a trailing newline", async () => {
  const { notesAi, events } = createHarness({
    httpsRequest: responseRequest([
      'data: {"type":"response.output_text.delta","delta":"尾行"}\n',
      'data: {"type":"response.completed"}',
    ]),
  });
  notesAi.complete({
    provider: { baseUrl: "https://example.test", apiKey: "test", model: "test" },
    mode: "summary",
    text: "内容",
  });
  await waitForTurn();
  assert.deepEqual(
    events.filter((event) => event.type === "delta").map((event) => event.text),
    ["尾行"],
  );
  assert.equal(events.filter((event) => event.type === "done").length, 1);
  assert.equal(events.filter((event) => event.type === "error").length, 0);
});

test("notes AI reports an HTTP non-2xx response exactly once", async () => {
  const { notesAi, events } = createHarness({
    httpsRequest: responseRequest(["unauthorized"], 401),
  });
  notesAi.complete({
    provider: { baseUrl: "https://example.test", apiKey: "test", model: "test" },
    mode: "summary",
    text: "内容",
  });
  await waitForTurn();
  assert.equal(events.filter((event) => event.type === "error").length, 1);
  assert.match(events.find((event) => event.type === "error")?.message || "", /接口错误 401/);
  assert.equal(events.filter((event) => event.type === "done").length, 0);
});

test("notes AI cancel clears a pending retry backoff", async (t) => {
  const timers = manualTimeouts(t);
  let requestCount = 0;
  const retryableResponse = responseRequest(["busy"], 503);
  const { notesAi, events } = createHarness({
    httpsRequest: (...args) => {
      requestCount += 1;
      return retryableResponse(...args);
    },
  });
  const { streamId } = notesAi.complete({
    provider: { baseUrl: "https://example.test", apiKey: "test", model: "test" },
    mode: "summary",
    text: "内容",
  });
  await waitForTurn();
  assert.equal(requestCount, 1);
  assert.equal(timers.size, 1);
  notesAi.cancel(streamId);
  assert.equal(timers.size, 0);
  assert.equal(requestCount, 1);
  assert.equal(events.filter((event) => event.type === "done" || event.type === "error").length, 0);
});

test("notes AI timeout emits one terminal error despite a late request error", async (t) => {
  const timers = manualTimeouts(t);
  let requestCount = 0;
  const { notesAi, events } = createHarness({
    httpsRequest: () => {
      requestCount += 1;
      const request = /** @type {any} */ (new EventEmitter());
      request.destroy = () => request.emit("error", new Error("late error"));
      request.end = () => request.emit("timeout");
      return request;
    },
  });
  notesAi.complete({
    provider: { baseUrl: "https://example.test", apiKey: "test", model: "test" },
    mode: "summary",
    text: "内容",
  });
  await waitForTurn();
  assert.equal(requestCount, 1);
  assert.equal(timers.size, 0);
  assert.equal(events.filter((event) => event.type === "error").length, 1);
  assert.equal(events.filter((event) => event.type === "done").length, 0);
});

test("pinned lookup supports the two-argument Node lookup signature", async () => {
  const lookup = createPinnedLookup({ address: "93.184.216.34", family: 4 });
  const result = await new Promise((resolve, reject) => {
    lookup("example.test", (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(result, { address: "93.184.216.34", family: 4 });
});

test("notes AI rejects a private DNS result before starting the request", async () => {
  let requested = false;
  const { notesAi, events } = createHarness({
    lookup: async () => [{ address: "169.254.169.254", family: 4 }],
    httpsRequest: () => {
      requested = true;
      throw new Error("must not request");
    },
  });
  notesAi.complete({
    provider: { baseUrl: "https://metadata.example", apiKey: "test", model: "test" },
    mode: "summary",
    text: "内容",
  });
  await waitForTurn();
  assert.equal(requested, false);
  assert.match(events.find((event) => event.type === "error")?.message || "", /禁止访问/);
});

test("notes AI allows explicitly supported public plaintext HTTP", async () => {
  let requested = false;
  const notesAi = createNotesAi({
    getWindow: () => null,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    httpRequest: (...args) => {
      requested = true;
      return responseRequest([])(...args);
    },
  });
  notesAi.complete({
    provider: { baseUrl: "http://example.test", apiKey: "test", model: "test" },
    mode: "summary",
    text: "内容",
  });
  await waitForTurn();
  assert.equal(requested, true);
});

test("notes AI handles a synchronous request constructor error exactly once", async () => {
  const { notesAi, events } = createHarness({
    httpsRequest: () => {
      throw new Error("invalid header");
    },
  });
  notesAi.complete({
    provider: { baseUrl: "https://example.test", apiKey: "bad", model: "test" },
    mode: "summary",
    text: "内容",
  });
  await waitForTurn();
  assert.equal(events.filter((event) => event.type === "error").length, 1);
  assert.match(events[0].message, /invalid header/);
});

test("notes AI requires and stamps the active principal in production mode", async () => {
  let principalId = "alice";
  const events = [];
  const notesAi = createNotesAi({
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: { send: (_channel, payload) => events.push(payload) },
    }),
    getPrincipalId: () => principalId,
    requirePrincipalContext: true,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    httpsRequest: responseRequest(['data: {"type":"response.completed"}\n']),
  });

  assert.throws(
    () =>
      notesAi.complete({
        principalId: "bob",
        provider: { baseUrl: "https://example.test", apiKey: "test", model: "test" },
        mode: "summary",
        text: "内容",
      }),
    /principal 已变化/,
  );

  const result = notesAi.complete({
    principalId,
    provider: { baseUrl: "https://example.test", apiKey: "test", model: "test" },
    mode: "summary",
    text: "内容",
  });
  await waitForTurn();
  assert.equal(result.principalId, "alice");
  assert.equal(events.at(-1)?.principalId, "alice");
});

test("notes AI cancelAll suppresses late delta, done and error events after a principal switch", async () => {
  let principalId = "alice";
  let responseCallback = /** @type {any} */ (null);
  let pendingRequest = /** @type {any} */ (null);
  let destroyed = false;
  const events = [];
  const notesAi = createNotesAi({
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: { send: (_channel, payload) => events.push(payload) },
    }),
    getPrincipalId: () => principalId,
    requirePrincipalContext: true,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    httpsRequest: /** @type {any} */ (
      (_options, callback) => {
        responseCallback = callback;
        const request = /** @type {any} */ (new EventEmitter());
        request.end = () => {};
        request.destroy = () => {
          destroyed = true;
        };
        pendingRequest = request;
        return request;
      }
    ),
  });

  notesAi.complete({
    principalId,
    provider: { baseUrl: "https://example.test", apiKey: "alice-key", model: "test" },
    mode: "summary",
    text: "alice content",
  });
  await waitForTurn();
  assert.equal(typeof responseCallback, "function");

  const cancelled = notesAi.cancelAll();
  principalId = "bob";
  const response = /** @type {any} */ (new PassThrough());
  response.statusCode = 200;
  responseCallback(response);
  response.write('data: {"type":"response.output_text.delta","delta":"late"}\n');
  response.write('data: {"type":"response.completed"}\n');
  pendingRequest.emit("error", new Error("late error"));
  response.end();
  await waitForTurn();

  assert.deepEqual(cancelled, { ok: true, count: 1 });
  assert.equal(destroyed, true);
  assert.deepEqual(events, []);
});

test("notes AI rejects queued work after invalidation until a principal is activated", () => {
  let principalId = "alice";
  const notesAi = createNotesAi({
    getWindow: () => null,
    getPrincipalId: () => principalId,
    requirePrincipalContext: true,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  const request = {
    principalId,
    provider: { baseUrl: "https://example.test", apiKey: "alice-key", model: "test" },
    mode: "summary",
    text: "alice content",
  };

  notesAi.invalidatePrincipal();
  assert.throws(() => notesAi.complete(request), /principal 已变化/);

  principalId = "bob";
  assert.deepEqual(notesAi.invalidatePrincipal("alice"), { ok: false, count: 0 });
  notesAi.activatePrincipal();
  assert.doesNotThrow(() =>
    notesAi.complete({
      ...request,
      principalId,
      provider: { ...request.provider, apiKey: "bob-key" },
    }),
  );
  notesAi.cancelAll();
});

test("notes AI bounds oversized non-2xx response bodies", async () => {
  const { notesAi, events } = createHarness({
    httpsRequest: responseRequest(["x".repeat(256 * 1024)], 400),
  });
  notesAi.complete({
    provider: { baseUrl: "https://example.test", apiKey: "test", model: "test" },
    mode: "summary",
    text: "内容",
  });
  await waitForTurn();
  assert.equal(events.filter((event) => event.type === "error").length, 1);
  assert.ok(events[0].message.length < 400);
});
