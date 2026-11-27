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
    closest: (selector) => (selector.startsWith("dialog,") ? null : editor),
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
  assert.equal(
    tracker.failRequest(
      conversationRequest("request-error", 17, { error: "net::ERR_CONNECTION_RESET" }),
    ),
    null,
  );
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
  assert.deepEqual(
    tracker.failRequest(
      conversationRequest("request-first", 17, { error: "net::ERR_CONNECTION_RESET" }),
    ),
    {
      id: "attempt-race",
      acceptedAt: 1200,
    },
  );
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

for (const action of ["keydown", "click"]) {
  for (const mutation of ["removed", "hidden"]) {
    test(`a ${action} send survives an editor ${mutation} by the page before its deferred marker`, () => {
      const token = createTrackerToken();
      const page = createTrackerHarness(token);
      page.listeners.get(action)(
        action === "keydown" ? enterEvent(page.editor) : { target: page.sendButton },
      );
      if (mutation === "removed") page.editor.isConnected = false;
      else page.editor.getBoundingClientRect = () => ({ width: 0, height: 0 });
      page.runNextTimeout();
      assert.equal(page.logs.length, 1);
      const attempt = parseSendAttemptMessage(page.logs[0], token);
      assert.ok(attempt);
      for (const [kind, url] of [
        ["gpt", "https://chatgpt.com/backend-api/conversation"],
        ["claude", "https://claude.ai/api/organizations/org/chat_conversations/chat/completion"],
        [
          "gemini",
          "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate",
        ],
      ]) {
        for (const statusCode of [200, 500]) {
          const tracker = createUsageAttemptTracker({ now: () => attempt.attemptedAt });
          tracker.record(attempt, 7);
          const request = { id: "request", webContentsId: 7, method: "POST", url, statusCode };
          tracker.recordRequestStart(kind, request);
          assert.equal(Boolean(tracker.acceptResponse(kind, request)), statusCode === 200);
          assert.equal(tracker.acceptResponse(kind, request), null);
        }
      }
    });
  }
}

test("an editor already hidden before Enter does not create a usage attempt", () => {
  const page = createTrackerHarness(createTrackerToken());
  page.editor.getBoundingClientRect = () => ({ width: 0, height: 0 });
  page.listeners.get("keydown")(enterEvent(page.editor));
  page.runNextTimeout();
  assert.deepEqual(page.logs, []);
});

test("non-send conversation subpaths such as prepare and gen_title are excluded", () => {
  for (const url of [
    "https://chatgpt.com/backend-api/f/conversation/prepare",
    "https://chatgpt.com/backend-api/conversation/init",
    "https://chatgpt.com/backend-api/conversation/gen_title",
  ]) {
    assert.equal(
      isAcceptedAiConversationResponse("gpt", { method: "POST", statusCode: 200, url }),
      false,
    );
  }
  assert.equal(
    isAcceptedAiConversationResponse("gpt", {
      method: "POST",
      statusCode: 200,
      url: "https://chatgpt.com/backend-api/f/conversation",
    }),
    true,
  );
  assert.equal(
    isAcceptedAiConversationResponse("claude", {
      method: "POST",
      statusCode: 200,
      url: "https://claude.ai/api/organizations/org/chat_conversations/chat/retry_completion",
    }),
    true,
  );
});

test("delayed requests after PoW/proxy latency still bind and early SSE stop still counts once", () => {
  let now = 1000;
  const tracker = createUsageAttemptTracker({ now: () => now });
  tracker.record({ id: "attempt-pow", attemptedAt: 1000 }, 21);
  // 6 seconds after Enter (ChatGPT sentinel/chat-requirements + PoW over proxy)
  now = 7000;
  tracker.recordRequestStart("gpt", conversationRequest("req-pow", 21));
  now = 7400;
  // onResponseStarted 200 accepts immediately
  assert.deepEqual(tracker.acceptResponse("gpt", conversationRequest("req-pow", 21)), {
    id: "attempt-pow",
    acceptedAt: 7400,
  });
  // Later abort (user clicked Stop generating) or onCompleted must not double-count or throw
  assert.equal(
    tracker.failRequest(conversationRequest("req-pow", 21, { error: "net::ERR_ABORTED" })),
    null,
  );
  assert.equal(tracker.acceptResponse("gpt", conversationRequest("req-pow", 21)), null);
});

test("unmatched 2xx conversation request falls back once when DOM probe misses, while 500 never counts", async () => {
  const accepted = [];
  const tracker = createUsageAttemptTracker({
    networkFallbackGraceMs: 60,
    onUnmatchedAccepted: (kind, webContentsId, event) =>
      accepted.push({ kind, webContentsId, event }),
  });
  tracker.recordRequestStart("gpt", conversationRequest("req-drift", 33));
  assert.equal(tracker.acceptResponse("gpt", conversationRequest("req-drift", 33)), null);
  tracker.recordRequestStart("gpt", conversationRequest("req-500", 33));
  assert.equal(
    tracker.acceptResponse("gpt", conversationRequest("req-500", 33, { statusCode: 500 })),
    null,
  );
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].kind, "gpt");
  assert.equal(accepted[0].webContentsId, 33);
  assert.match(accepted[0].event.id, /^net-/);
});

const fallbackWait = () => new Promise((resolve) => setTimeout(resolve, 110));
function fallbackHarness(options = {}) {
  const events = [];
  const tracker = createUsageAttemptTracker({
    networkFallbackGraceMs: 50,
    onUnmatchedAccepted: (_kind, _contents, event) => events.push(event),
    ...options,
  });
  const accept = (id, wc = 17) => {
    const request = conversationRequest(id, wc);
    tracker.recordRequestStart("gpt", request);
    return tracker.acceptResponse("gpt", request);
  };
  return { tracker, events, accept };
}

test("2xx then a broken stream and automatic retry count only the original gesture", async (t) => {
  let now = 1000;
  const { tracker, events, accept } = fallbackHarness({ now: () => now });
  t.after(() => tracker.clear());
  tracker.record({ id: "original-send", attemptedAt: now }, 17);
  assert.equal(accept("original").id, "original-send");
  now = 1010;
  tracker.failRequest(conversationRequest("original", 17, { error: "net::ERR_CONNECTION_RESET" }));
  now = 1020;
  accept("retry");
  await fallbackWait();
  assert.equal(events.length, 0);
  // A new explicit gesture owns its request, even inside the retry window.
  now = 1100;
  tracker.record({ id: "new-send", attemptedAt: now }, 17);
  assert.equal(accept("new").id, "new-send");
  accept("other-workspace", 18);
  await fallbackWait();
  assert.equal(events.length, 1);
});

test("a missing marker still counts a 2xx response aborted within fallback grace exactly once", async (t) => {
  const { tracker, events, accept } = fallbackHarness();
  t.after(() => tracker.clear());
  accept("early-stop");
  tracker.failRequest(conversationRequest("early-stop", 17, { error: "net::ERR_ABORTED" }));
  await fallbackWait();
  assert.equal(events.length, 1);
  tracker.acceptResponse("gpt", conversationRequest("early-stop", 17));
  tracker.completeRequest("gpt", conversationRequest("early-stop", 17));
  await fallbackWait();
  assert.equal(events.length, 1);
});

test("an old bound attempt outside its binding window cannot swallow a newer accepted request", async (t) => {
  let now = 1000;
  const { tracker, events, accept } = fallbackHarness({
    now: () => now,
    ttlMs: 1000,
    requestStartWindowMs: 100,
  });
  t.after(() => tracker.clear());
  tracker.record({ id: "old-attempt", attemptedAt: now }, 17);
  tracker.recordRequestStart("gpt", conversationRequest("old-hung", 17));
  now = 2500;
  accept("later-send");
  await fallbackWait();
  assert.equal(events.length, 1);
});

for (const error of ["net::ERR_ABORTED", "net::ERR_CONNECTION_RESET", undefined]) {
  for (const early of [true, false]) {
    test(`missing DOM markers count both questions after ${error}, early stop: ${early}`, async (t) => {
      let now = 1000;
      const { tracker, events, accept } = fallbackHarness({ now: () => now });
      t.after(() => tracker.clear());
      accept("question-one");
      if (!early) await fallbackWait();
      tracker.failRequest(conversationRequest("question-one", 17, { error }));
      await fallbackWait();
      assert.equal(events.length, 1);
      now += 1000;
      accept("question-two");
      tracker.completeRequest("gpt", conversationRequest("question-two", 17));
      await fallbackWait();
      assert.equal(events.length, 2);
      assert.notEqual(events[0].id, events[1].id);
      tracker.acceptResponse("gpt", conversationRequest("question-one", 17));
      tracker.completeRequest("gpt", conversationRequest("question-one", 17));
      tracker.completeRequest("gpt", conversationRequest("question-two", 17));
      await fallbackWait();
      assert.equal(events.length, 2);
    });
  }
}

for (const completed of [false, true]) {
  test(`a DOM-bound ${completed ? "completed" : "aborted"} stream cannot own the next unmarked question`, async (t) => {
    let now = 1000;
    const { tracker, events, accept } = fallbackHarness({ now: () => now });
    t.after(() => tracker.clear());
    tracker.record({ id: "first-send", attemptedAt: now }, 17);
    assert.equal(accept("first-question").id, "first-send");
    if (completed) tracker.completeRequest("gpt", conversationRequest("first-question", 17));
    tracker.failRequest(
      conversationRequest("first-question", 17, {
        error: completed ? "net::ERR_CONNECTION_RESET" : "net::ERR_ABORTED",
      }),
    );
    now += 1000;
    accept("second-question");
    await fallbackWait();
    assert.equal(events.length, 1);
  });
}

test("an aborted request before acceptance releases its DOM attempt without retry ownership", () => {
  let now = 1000;
  const tracker = createUsageAttemptTracker({ now: () => now });
  tracker.record({ id: "cancelled-send", attemptedAt: now }, 17);
  tracker.recordRequestStart("gpt", conversationRequest("cancelled", 17));
  tracker.failRequest(conversationRequest("cancelled", 17, { error: "net::ERR_ABORTED" }));
  assert.deepEqual(tracker.size(), { attempts: 0, requests: 0 });
  now += 1000;
  tracker.recordRequestStart("gpt", conversationRequest("new-send", 17));
  assert.equal(tracker.acceptResponse("gpt", conversationRequest("new-send", 17)), null);
  tracker.clear();
});

test("blocked fallback is rechecked after a bound attempt's window expires", async (t) => {
  let now = 1000;
  const { tracker, events, accept } = fallbackHarness({ now: () => now, ttlMs: 1000 });
  t.after(() => tracker.clear());
  tracker.record({ id: "hung-attempt", attemptedAt: now }, 17);
  tracker.recordRequestStart("gpt", conversationRequest("hung", 17));
  now = 1100;
  accept("overlap");
  await fallbackWait();
  assert.equal(events.length, 0);
  now = 2100;
  await fallbackWait();
  assert.equal(events.length, 1);
});

test("blocked fallback is transferred on failure, and clear cancels pending account work", async () => {
  let now = 1000;
  const { tracker, events, accept } = fallbackHarness({ now: () => now });
  tracker.record({ id: "retry-owner", attemptedAt: now }, 17);
  tracker.recordRequestStart("gpt", conversationRequest("first", 17));
  now = 1100;
  accept("second");
  await fallbackWait();
  assert.equal(events.length, 0);
  assert.equal(
    tracker.failRequest(conversationRequest("first", 17, { error: "net::ERR_CONNECTION_RESET" }))
      .id,
    "retry-owner",
  );
  await fallbackWait();
  assert.equal(events.length, 0);
  accept("pending-other", 18);
  tracker.clear();
  await fallbackWait();
  assert.equal(events.length, 0);
});

test("a long accepted stream and slow automatic retry retain their already settled gesture", async (t) => {
  let now = 1000;
  const { tracker, events, accept } = fallbackHarness({ now: () => now, ttlMs: 1000 });
  t.after(() => tracker.clear());
  tracker.record({ id: "long-stream-send", attemptedAt: now }, 17);
  assert.equal(accept("long-stream").id, "long-stream-send");
  now = 61000;
  tracker.failRequest(
    conversationRequest("long-stream", 17, { error: "net::ERR_CONNECTION_RESET" }),
  );
  now = 61100;
  tracker.recordRequestStart("gpt", conversationRequest("slow-retry", 17));
  now = 61900;
  tracker.acceptResponse("gpt", conversationRequest("slow-retry", 17));
  now = 63000;
  await fallbackWait();
  assert.equal(
    events.length,
    0,
    "the retry owns a retained settlement even when the prior tombstone expires",
  );
  assert.equal(tracker.completeRequest("gpt", conversationRequest("slow-retry", 17)), null);
});
