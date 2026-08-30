const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const vm = require("node:vm");

const {
  COMPOSER_GUARD_BLOCKED_EVENT,
  createAcceptedSendDedupe,
  createTrackerToken,
  createUsageAttemptTracker,
  installAcceptedSendTracker,
  isAcceptedAiConversationResponse,
  parseSendAttemptMessage,
  sendAttemptMarker,
  sendAttemptTrackerScript,
} = require("../aiUsageAcceptance");

test("tracker installation uses a fixed isolated world instead of arbitrary renderer code", async () => {
  const calls = [];
  const token = createTrackerToken();
  const result = await installAcceptedSendTracker(
    {
      isDestroyed: () => false,
      executeJavaScriptInIsolatedWorld: async (...args) => {
        calls.push(args);
        return true;
      },
    },
    token,
  );
  assert.equal(result, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 1002);
  assert.equal(Array.isArray(calls[0][1]), true);
  assert.match(calls[0][1][0].code, /attemptedAt/);
  assert.doesNotMatch(calls[0][1][0].code, /acceptedAt/);
});

test("send attempt messages contain an opaque id and no prompt text", () => {
  const token = createTrackerToken();
  const message = `${sendAttemptMarker(token)}${JSON.stringify({ id: "m1-1", attemptedAt: 42 })}`;
  assert.deepEqual(parseSendAttemptMessage(message, token), { id: "m1-1", attemptedAt: 42 });
  assert.equal(
    parseSendAttemptMessage(
      `${sendAttemptMarker(token)}${JSON.stringify({ id: "m1-1", attemptedAt: 42, text: "secret" })}`,
      token,
    ),
    null,
  );
});

test("a marker from another workspace is rejected", () => {
  const token = createTrackerToken();
  const other = createTrackerToken();
  const message = `${sendAttemptMarker(other)}${JSON.stringify({ id: "m1-1", attemptedAt: 42 })}`;
  assert.equal(parseSendAttemptMessage(message, token), null);
});

test("the page tracker records an opaque attempt and never reads a successful DOM clearing", () => {
  const script = sendAttemptTrackerScript(createTrackerToken());
  assert.match(script, /blockedEventName/);
  assert.doesNotMatch(script, /reportAccepted|acceptedAt/);
  assert.match(script, /console\.log\(marker/);
  assert.doesNotMatch(script, /slice\(0, 160\)|JSON\.stringify\(\{ text/);
});

test("accepted send ids are reported once within the dedupe window", () => {
  let now = 1000;
  const dedupe = createAcceptedSendDedupe({ now: () => now, ttlMs: 2000 });
  assert.equal(dedupe.accept("send-one"), true);
  assert.equal(dedupe.accept("send-one"), false);
  assert.equal(dedupe.accept("send-two"), true);
  now = 3001;
  assert.equal(dedupe.accept("send-one"), true);
});

function createTrackerHarness(token) {
  const listeners = new Map();
  const timeoutCallbacks = [];
  const logs = [];
  const editor = {
    value: "question",
    isConnected: true,
    matches: () => true,
    closest: () => editor,
    querySelector: () => editor,
    contains: (node) => node === editor || node === sendButton,
    getBoundingClientRect: () => ({ width: 300, height: 80 }),
  };
  const document = {
    activeElement: editor,
    addEventListener: (type, listener) => listeners.set(type, listener),
    querySelectorAll: () => [editor],
  };
  const sendButton = {
    closest: () => sendButton,
  };
  const context = {
    console: { log: (value) => logs.push(String(value)) },
    crypto: { randomUUID },
    document,
    setTimeout: (callback) => {
      timeoutCallbacks.push(callback);
      return timeoutCallbacks.length;
    },
    Date,
  };
  vm.runInNewContext(sendAttemptTrackerScript(token), context);
  return {
    editor,
    listeners,
    logs,
    sendButton,
    runNextTimeout: () => timeoutCallbacks.shift()?.(),
  };
}

function enterEvent(editor) {
  return {
    key: "Enter",
    target: editor,
    defaultPrevented: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
  };
}

test("an unblocked gesture emits one attempt without waiting for editor clearing", () => {
  const token = createTrackerToken();
  const harness = createTrackerHarness(token);
  harness.listeners.get("keydown")(enterEvent(harness.editor));
  assert.equal(harness.logs.length, 0);
  harness.runNextTimeout();
  assert.equal(harness.editor.value, "question");
  assert.equal(harness.logs.length, 1);
  assert.ok(parseSendAttemptMessage(harness.logs[0], token));
});

test("a composer guard cancels an attempt before it leaves the isolated world", () => {
  const token = createTrackerToken();
  const harness = createTrackerHarness(token);
  const event = enterEvent(harness.editor);
  harness.listeners.get("keydown")(event);
  event.defaultPrevented = true;
  harness.listeners.get(COMPOSER_GUARD_BLOCKED_EVENT)({ target: harness.editor });
  harness.runNextTimeout();
  assert.equal(harness.logs.length, 0);
});

test("one Enter followed by its submit click reserves only one attempt", () => {
  const token = createTrackerToken();
  const harness = createTrackerHarness(token);
  harness.listeners.get("keydown")(enterEvent(harness.editor));
  harness.listeners.get("click")({
    target: harness.sendButton,
    defaultPrevented: false,
  });
  harness.runNextTimeout();
  assert.equal(harness.logs.length, 1);
  assert.ok(parseSendAttemptMessage(harness.logs[0], token));
});

test("the same editor can emit two distinct attempts in consecutive event loops", () => {
  const token = createTrackerToken();
  const harness = createTrackerHarness(token);
  harness.listeners.get("keydown")(enterEvent(harness.editor));
  harness.runNextTimeout();
  harness.editor.value = "second question";
  harness.listeners.get("keydown")(enterEvent(harness.editor));
  harness.runNextTimeout();
  assert.equal(harness.logs.length, 2);
  const attempts = harness.logs.map((message) => parseSendAttemptMessage(message, token));
  assert.ok(attempts.every(Boolean));
  assert.notEqual(attempts[0].id, attempts[1].id);
});

test("separate page trackers use strong unique ids instead of local timestamp counters", () => {
  const firstToken = createTrackerToken();
  const secondToken = createTrackerToken();
  const first = createTrackerHarness(firstToken);
  const second = createTrackerHarness(secondToken);
  first.listeners.get("keydown")(enterEvent(first.editor));
  second.listeners.get("keydown")(enterEvent(second.editor));
  first.runNextTimeout();
  second.runNextTimeout();
  const firstAttempt = parseSendAttemptMessage(first.logs[0], firstToken);
  const secondAttempt = parseSendAttemptMessage(second.logs[0], secondToken);
  assert.ok(firstAttempt);
  assert.ok(secondAttempt);
  assert.notEqual(firstAttempt.id, secondAttempt.id);
  assert.match(sendAttemptTrackerScript(firstToken), /crypto\?\.randomUUID/);
  assert.doesNotMatch(sendAttemptTrackerScript(firstToken), /sequence/);
});

test("only successful known conversation responses qualify as acceptance", () => {
  const fixtures = [
    ["gpt", "https://chatgpt.com/backend-api/conversation"],
    ["gpt", "https://chatgpt.com/backend-api/f/conversation"],
    ["claude", "https://claude.ai/api/organizations/org/chat_conversations/chat/completion"],
    [
      "gemini",
      "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate",
    ],
  ];
  for (const [kind, url] of fixtures) {
    assert.equal(
      isAcceptedAiConversationResponse(kind, { method: "POST", statusCode: 200, url }),
      true,
    );
    assert.equal(
      isAcceptedAiConversationResponse(kind, { method: "POST", statusCode: 500, url }),
      false,
    );
  }
  assert.equal(
    isAcceptedAiConversationResponse("gpt", {
      method: "POST",
      statusCode: 200,
      url: "https://chatgpt.com/backend-api/settings",
    }),
    false,
  );
});

function conversationRequest(id, webContentsId, overrides = {}) {
  return {
    id,
    webContentsId,
    method: "POST",
    statusCode: 200,
    url: "https://chatgpt.com/backend-api/conversation",
    ...overrides,
  };
}

test("an attempt becomes accepted only by its bound request id and 2xx completion", () => {
  let now = 1000;
  const tracker = createUsageAttemptTracker({ now: () => now, ttlMs: 5000 });
  assert.equal(tracker.record({ id: "attempt-1", attemptedAt: 1000 }, 17), null);
  now = 1001;
  assert.equal(tracker.recordRequestStart("gpt", conversationRequest("request-1", 17)), null);
  assert.equal(
    tracker.acceptResponse(
      "gpt",
      conversationRequest("request-other", 17, {
        url: "https://chatgpt.com/backend-api/settings",
      }),
    ),
    null,
  );
  assert.equal(tracker.acceptResponse("gpt", conversationRequest("request-1", 18)), null);
  now = 1200;
  assert.deepEqual(tracker.acceptResponse("gpt", conversationRequest("request-1", 17)), {
    id: "attempt-1",
    acceptedAt: 1200,
  });
  assert.equal(tracker.acceptResponse("gpt", conversationRequest("request-1", 17)), null);
});

test("expired attempts and requests are explicitly discarded", () => {
  let now = 1000;
  const tracker = createUsageAttemptTracker({ now: () => now, ttlMs: 1000 });
  tracker.record({ id: "attempt-1", attemptedAt: 1000 }, 17);
  tracker.recordRequestStart("gpt", conversationRequest("request-1", 18));
  now = 2001;
  tracker.expire();
  assert.deepEqual(tracker.size(), { attempts: 0, requests: 0 });
  assert.equal(tracker.acceptResponse("gpt", conversationRequest("request-1", 17)), null);
});

test("a fast completion before the console marker remains bound to its request id", () => {
  let now = 1000;
  const tracker = createUsageAttemptTracker({ now: () => now, ttlMs: 5000 });
  tracker.recordRequestStart("gpt", conversationRequest("request-fast", 17));
  now = 1001;
  assert.equal(tracker.acceptResponse("gpt", conversationRequest("request-fast", 17)), null);
  now = 1001;
  assert.deepEqual(tracker.record({ id: "attempt-fast", attemptedAt: 999 }, 17), {
    id: "attempt-fast",
    acceptedAt: 1001,
  });
});

test("an old successful response cannot accept a later failed attempt", () => {
  let now = 1000;
  const tracker = createUsageAttemptTracker({ now: () => now, ttlMs: 5000 });
  tracker.recordRequestStart("gpt", conversationRequest("old-request", 17));
  now = 1100;
  tracker.acceptResponse("gpt", conversationRequest("old-request", 17));
  now = 2000;
  tracker.record({ id: "new-attempt", attemptedAt: 2000 }, 17);
  now = 2001;
  tracker.recordRequestStart("gpt", conversationRequest("failed-request", 17));
  now = 2050;
  assert.equal(
    tracker.acceptResponse("gpt", conversationRequest("failed-request", 17, { statusCode: 500 })),
    null,
  );
  assert.deepEqual(tracker.size(), { attempts: 1, requests: 1 });
  now = 17_001;
  tracker.expire();
  assert.deepEqual(tracker.size(), { attempts: 0, requests: 0 });
  tracker.recordRequestStart("gpt", conversationRequest("unrelated-request", 17));
  assert.equal(
    tracker.acceptResponse("gpt", conversationRequest("unrelated-request", 17)),
    null,
    "a request outside the failed gesture window must not resurrect it",
  );
});

test("out-of-order success and failure settle only their own attempts", () => {
  let now = 1000;
  const tracker = createUsageAttemptTracker({ now: () => now, ttlMs: 5000 });
  tracker.record({ id: "attempt-fail", attemptedAt: 1000 }, 17);
  now = 1001;
  tracker.recordRequestStart("gpt", conversationRequest("request-fail", 17));
  now = 1010;
  tracker.record({ id: "attempt-success", attemptedAt: 1010 }, 17);
  now = 1011;
  tracker.recordRequestStart("gpt", conversationRequest("request-success", 17));
  now = 1100;
  assert.deepEqual(tracker.acceptResponse("gpt", conversationRequest("request-success", 17)), {
    id: "attempt-success",
    acceptedAt: 1100,
  });
  now = 1200;
  assert.equal(
    tracker.acceptResponse("gpt", conversationRequest("request-fail", 17, { statusCode: 500 })),
    null,
  );
  assert.deepEqual(tracker.size(), { attempts: 1, requests: 0 });
  now = 16_011;
  tracker.expire();
  assert.deepEqual(tracker.size(), { attempts: 0, requests: 0 });
});

test("a failed request releases its attempt for one bounded successful retry", () => {
  let now = 1000;
  const tracker = createUsageAttemptTracker({ now: () => now, ttlMs: 5000 });
  tracker.record({ id: "attempt-error", attemptedAt: 1000 }, 17);
  tracker.recordRequestStart("gpt", conversationRequest("request-error", 17));
  assert.equal(tracker.failRequest(conversationRequest("request-error", 17)), null);
  assert.deepEqual(tracker.size(), { attempts: 1, requests: 0 });
  now = 1100;
  tracker.recordRequestStart("gpt", conversationRequest("request-retry", 17));
  now = 1200;
  assert.deepEqual(tracker.acceptResponse("gpt", conversationRequest("request-retry", 17)), {
    id: "attempt-error",
    acceptedAt: 1200,
  });
  assert.deepEqual(tracker.size(), { attempts: 0, requests: 0 });
});

test("a retry that completes before the first request fails is accepted by exact request id", () => {
  let now = 1000;
  const tracker = createUsageAttemptTracker({ now: () => now, ttlMs: 5000 });
  tracker.record({ id: "attempt-race", attemptedAt: 1000 }, 17);
  tracker.recordRequestStart("gpt", conversationRequest("request-first", 17));
  now = 1100;
  tracker.recordRequestStart("gpt", conversationRequest("request-retry", 17));
  now = 1200;
  assert.equal(tracker.acceptResponse("gpt", conversationRequest("request-retry", 17)), null);
  now = 1300;
  assert.deepEqual(tracker.failRequest(conversationRequest("request-first", 17)), {
    id: "attempt-race",
    acceptedAt: 1200,
  });
  assert.deepEqual(tracker.size(), { attempts: 0, requests: 0 });
});

test("a bound streaming request can complete after the gesture ttl", () => {
  let now = 1000;
  const tracker = createUsageAttemptTracker({
    now: () => now,
    ttlMs: 5000,
    requestCompletionTtlMs: 60_000,
  });
  tracker.record({ id: "attempt-stream", attemptedAt: 1000 }, 17);
  tracker.recordRequestStart("gpt", conversationRequest("request-stream", 17));
  now = 20_000;
  assert.deepEqual(tracker.acceptResponse("gpt", conversationRequest("request-stream", 17)), {
    id: "attempt-stream",
    acceptedAt: 20_000,
  });
});
