const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createPinnedLookup } = require("../endpointSecurity");
const { createNotesAi } = require("../notesAi");

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
