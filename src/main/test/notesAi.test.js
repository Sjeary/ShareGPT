const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const http = require("node:http");
const { createNotesAi } = require("../notesAi");

function waitForTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function withHttpResponse(t, chunks) {
  const original = http.request;
  http.request = /** @type {any} */ (
    (_options, callback) => {
      const request = /** @type {any} */ (new EventEmitter());
      request.destroy = () => {};
      request.end = () => {
        const response = /** @type {any} */ (new PassThrough());
        response.statusCode = 200;
        callback(response);
        for (const chunk of chunks) response.write(chunk);
        response.end();
      };
      return request;
    }
  );
  t.after(() => {
    http.request = original;
  });
}

function createHarness() {
  const events = [];
  const notesAi = createNotesAi({
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        send: (_channel, payload) => events.push(payload),
      },
    }),
  });
  return { notesAi, events };
}

test("notes AI completed event emits one terminal done", async (t) => {
  withHttpResponse(t, [
    'data: {"type":"response.output_text.delta","delta":"完成"}\n',
    'data: {"type":"response.completed"}\n',
  ]);
  const { notesAi, events } = createHarness();
  notesAi.complete({
    provider: { baseUrl: "http://example.test", apiKey: "test", model: "test" },
    mode: "summary",
    text: "内容",
  });
  await waitForTurn();
  assert.equal(events.filter((event) => event.type === "delta").length, 1);
  assert.equal(events.filter((event) => event.type === "done").length, 1);
  assert.equal(events.filter((event) => event.type === "error").length, 0);
});

test("notes AI failed event is not followed by done", async (t) => {
  withHttpResponse(t, ['data: {"type":"response.failed","error":{"message":"拒绝"}}\n']);
  const { notesAi, events } = createHarness();
  notesAi.complete({
    provider: { baseUrl: "http://example.test", apiKey: "test", model: "test" },
    mode: "summary",
    text: "内容",
  });
  await waitForTurn();
  assert.equal(events.filter((event) => event.type === "error").length, 1);
  assert.equal(events.filter((event) => event.type === "done").length, 0);
});
