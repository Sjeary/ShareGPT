const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const {
  assertComposerOperationCurrent,
  composerConfirmationFinalizeScript,
  composerOperationIsCurrent,
  composerConfirmationGuardScript,
  composerConfirmationResolveScript,
  composerWriteScript,
  createComposerConfirmationStore,
  createComposerOperation,
  createOperationToken,
  executeComposerWrite,
  hasClearlyNonTargetLanguage,
  parseComposerConfirmationMessage,
  sendComposerEnter,
  shouldGuardComposerSubmit,
  waitForComposerOutcome,
} = require("../aiComposerOperation");

function snapshot(overrides = {}) {
  return {
    principalId: "principal-a",
    kind: "gpt",
    environmentId: "env-work",
    tabId: "gpt-1",
    workspaceInstanceId: "workspace-one",
    webContentsId: 42,
    documentEpoch: 3,
    url: "https://chatgpt.com/c/one",
    ...overrides,
  };
}

test("an explicit composer operation is bound to one live view and document epoch", () => {
  const operation = createComposerOperation(snapshot(), {
    text: " translated question ",
    send: true,
  });
  assert.equal(operation.text, "translated question");
  assert.equal(operation.send, true);
  assert.equal(composerOperationIsCurrent(operation, snapshot()), true);
  assert.equal(
    composerOperationIsCurrent(operation, snapshot({ workspaceInstanceId: "replacement-view" })),
    false,
  );
  assert.equal(composerOperationIsCurrent(operation, snapshot({ documentEpoch: 4 })), false);
  assert.equal(composerOperationIsCurrent(operation, snapshot({ tabId: "gpt-2" })), false);
  assert.equal(
    composerOperationIsCurrent(operation, snapshot({ environmentId: "env-private" })),
    false,
  );
  assert.equal(
    composerOperationIsCurrent(operation, snapshot({ principalId: "principal-b" })),
    false,
  );
});

test("stale operations return one actionable product error", () => {
  const operation = createComposerOperation(snapshot(), { text: "hello" });
  assert.throws(() => assertComposerOperationCurrent(operation, snapshot({ documentEpoch: 4 })), {
    code: "COMPOSER_TARGET_CHANGED",
    message: "网页或标签已经变化，请重新操作",
  });
});

test("a SPA route epoch invalidates an operation even when the renderer is reused", () => {
  const operation = createComposerOperation(snapshot(), { text: "translated", send: false });
  const spaRoute = snapshot({
    documentEpoch: 4,
    url: "https://chatgpt.com/c/next-route",
  });
  assert.equal(composerOperationIsCurrent(operation, spaRoute), false);
  assert.throws(() => assertComposerOperationCurrent(operation, spaRoute), {
    code: "COMPOSER_TARGET_CHANGED",
    message: "网页或标签已经变化，请重新操作",
  });
});

test("normal Enter is untouched unless send confirmation is explicitly enabled", () => {
  assert.equal(shouldGuardComposerSubmit({}), false);
  assert.equal(shouldGuardComposerSubmit({ translation: {} }), false);
  assert.equal(shouldGuardComposerSubmit({ translation: { confirmNonTargetSend: false } }), false);
  assert.equal(shouldGuardComposerSubmit({ translation: { confirmNonTargetSend: true } }), true);
});

test("language detection only flags clearly non-target input", () => {
  assert.equal(hasClearlyNonTargetLanguage("你好，帮我总结", "en"), true);
  assert.equal(hasClearlyNonTargetLanguage("Please summarize this", "en"), false);
  assert.equal(hasClearlyNonTargetLanguage("Please summarize this", "zh"), true);
  assert.equal(hasClearlyNonTargetLanguage("请总结这段内容", "zh"), false);
  assert.equal(hasClearlyNonTargetLanguage("123 !!!", "en"), false);
});

function createConfirmationHarness(token, enabled = true) {
  const listeners = new Map();
  const logs = [];
  let cleared = 0;
  const editor = {
    value: "",
    isConnected: true,
    matches: () => true,
    closest: () => editor,
    querySelector: () => editor,
    contains: (node) => node === editor || node === button,
    focus: () => undefined,
    getBoundingClientRect: () => ({ width: 300, height: 60 }),
  };
  const button = {
    isConnected: true,
    closest: () => button,
    getBoundingClientRect: () => ({ width: 80, height: 32 }),
    click() {
      listeners.get("click")?.({
        target: button,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopImmediatePropagation() {},
      });
    },
  };
  const document = {
    activeElement: editor,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    querySelectorAll: () => [editor],
  };
  const context = {
    console: { log: (value) => logs.push(String(value)) },
    crypto: { randomUUID: () => "12345678-1234-1234-1234-123456789abc" },
    document,
    location: { href: "https://chatgpt.com/c/one" },
    setTimeout: () => 1,
    clearTimeout: () => {
      cleared += 1;
    },
    Date,
    Math,
    WeakMap,
    Map,
  };
  vm.runInNewContext(
    composerConfirmationGuardScript(token, { enabled, targetLanguage: "en" }),
    context,
  );
  const enter = () => {
    const event = {
      key: "Enter",
      target: editor,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
      isComposing: false,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopImmediatePropagation() {},
    };
    listeners.get("keydown")?.(event);
    return event;
  };
  return {
    button,
    context,
    editor,
    enter,
    listeners,
    logs,
    get cleared() {
      return cleared;
    },
  };
}

test("guard off installs no Enter listener and guard on passes target-language Enter", () => {
  const token = createOperationToken();
  const off = createConfirmationHarness(token, false);
  assert.equal(off.listeners.has("keydown"), false);

  const on = createConfirmationHarness(token, true);
  on.editor.value = "Please summarize this page";
  const event = on.enter();
  assert.equal(event.defaultPrevented, false);
  assert.equal(on.logs.length, 0);
});

test("non-target Enter is blocked with an opaque marker and confirm replays once", () => {
  const token = createOperationToken();
  const harness = createConfirmationHarness(token, true);
  harness.editor.value = "请总结这段内容";
  const blocked = harness.enter();
  assert.equal(blocked.defaultPrevented, true);
  assert.equal(harness.logs.length, 1);
  assert.doesNotMatch(harness.logs[0], /请总结/);
  const pending = parseComposerConfirmationMessage(harness.logs[0], token);
  assert.deepEqual(pending, {
    id: "12345678-1234-1234-1234-123456789abc",
    action: "enter",
    targetLanguage: "en",
  });
  const resolved = vm.runInNewContext(
    composerConfirmationResolveScript(token, pending.id, true),
    harness.context,
  );
  assert.equal(resolved.ok, true);
  assert.equal(resolved.replay, "enter");
  assert.equal(typeof resolved.replayId, "string");
  const replay = harness.enter();
  assert.equal(replay.defaultPrevented, false);
  assert.equal(harness.logs.length, 1);
});

test("confirmation replay is finalized only after the page consumes the bypass", () => {
  const token = createOperationToken();
  const harness = createConfirmationHarness(token, true);
  harness.editor.value = "请总结这段内容";
  harness.enter();
  const pending = parseComposerConfirmationMessage(harness.logs[0], token);
  const resolved = vm.runInNewContext(
    composerConfirmationResolveScript(token, pending.id, true),
    harness.context,
  );
  const premature = vm.runInNewContext(
    composerConfirmationFinalizeScript(token, resolved.replayId),
    harness.context,
  );
  assert.equal(premature.ok, true);
  assert.equal(premature.consumed, false);
  const replay = harness.enter();
  assert.equal(replay.defaultPrevented, false);
  const finalized = vm.runInNewContext(
    composerConfirmationFinalizeScript(token, resolved.replayId),
    harness.context,
  );
  assert.equal(finalized.ok, true);
  assert.equal(finalized.consumed, true);
  const next = harness.enter();
  assert.equal(next.defaultPrevented, true, "finalize must not leave a later Enter bypassed");
});

test("click confirmation reports sent only after its one-shot bypass is consumed", () => {
  const token = createOperationToken();
  const harness = createConfirmationHarness(token, true);
  harness.editor.value = "请发送这段内容";
  harness.button.click();
  const pending = parseComposerConfirmationMessage(harness.logs[0], token);
  assert.equal(pending.action, "click");
  const resolved = vm.runInNewContext(
    composerConfirmationResolveScript(token, pending.id, true),
    harness.context,
  );
  assert.equal(resolved.replay, "click");
  assert.equal(resolved.replayId, pending.id);
  const finalized = vm.runInNewContext(
    composerConfirmationFinalizeScript(token, resolved.replayId),
    harness.context,
  );
  assert.equal(finalized.consumed, true);
});

test("guard settings reconfigure an already-loaded document immediately", () => {
  const token = createOperationToken();
  const harness = createConfirmationHarness(token, true);
  assert.equal(harness.listeners.has("keydown"), true);
  vm.runInNewContext(
    composerConfirmationGuardScript(token, { enabled: false, targetLanguage: "en" }),
    harness.context,
  );
  assert.equal(harness.listeners.has("keydown"), false);
  assert.equal(harness.listeners.has("click"), false);
});

test("confirmation storage is opaque, expiring, and one-shot", () => {
  let now = 100;
  const store = createComposerConfirmationStore({ now: () => now, ttlMs: 1000 });
  const stored = store.put("12345678-abcd", { target: { tabId: "gpt-1" } });
  assert.equal(stored.requestId, "12345678-abcd");
  assert.equal(store.take("12345678-abcd"), stored);
  assert.equal(store.take("12345678-abcd"), null);
  store.put("87654321-abcd", { target: { tabId: "gpt-1" } });
  now = 1101;
  assert.equal(store.take("87654321-abcd"), null);
});

test("the generated script creates only an operation-scoped one-shot Enter gate", () => {
  const operation = createComposerOperation(snapshot(), { text: "hello", send: true });
  const script = composerWriteScript(operation);
  assert.match(script, /__shareGptOneShotComposerOperation/);
  assert.match(script, /removeEventListener\('keydown'/);
  assert.match(script, /currentUrl\(\) !== state\.url/);
  assert.doesNotMatch(script, /documentNonce|before-input-event|confirmNonTargetSend/);
});

test("write execution uses a fixed isolated-world call and rejects page failure", async () => {
  const calls = [];
  const operation = createComposerOperation(snapshot(), { text: "hello" });
  const webContents = {
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: async (...args) => {
      calls.push(args);
      return { ok: true, sent: false };
    },
  };
  assert.deepEqual(await executeComposerWrite(webContents, operation), { ok: true, sent: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 1001);
  assert.equal(calls[0][2], false);

  webContents.executeJavaScriptInIsolatedWorld = async () => ({
    ok: false,
    sent: false,
    reason: "no-editor",
  });
  await assert.rejects(() => executeComposerWrite(webContents, operation), {
    code: "COMPOSER_WRITE_REJECTED",
    message: "请先点击网页输入框",
  });
});

test("trusted Enter is emitted only after the one-shot gate is armed", () => {
  const events = [];
  sendComposerEnter({
    isDestroyed: () => false,
    sendInputEvent: (event) => events.push(event),
  });
  assert.deepEqual(events, [
    { type: "keyDown", keyCode: "Enter" },
    { type: "keyUp", keyCode: "Enter" },
  ]);
});

test("send outcome polling distinguishes accepted and stale operations", async () => {
  const operation = createComposerOperation(snapshot(), { text: "hello", send: true });
  const outcomes = [
    { token: operation.token, status: "armed", reason: "" },
    { token: operation.token, status: "accepted", reason: "" },
  ];
  const webContents = {
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: async () => outcomes.shift(),
  };
  assert.deepEqual(await waitForComposerOutcome(webContents, operation.token, { intervalMs: 1 }), {
    token: operation.token,
    status: "accepted",
    reason: "",
  });
});

function runComposerScript(operation, options = {}) {
  const listeners = new Map();
  const editor = {
    value: options.initialText || "",
    isConnected: true,
    matches: () => true,
    closest: () => editor,
    querySelector: () => editor,
    contains: (node) => node === editor,
    getBoundingClientRect: () => ({ width: 300, height: 80 }),
    dispatchEvent: () => true,
    focus: () => {},
    setSelectionRange: () => {},
  };
  const document = {
    activeElement: editor,
    querySelector: () => editor,
    querySelectorAll: () => [editor],
  };
  let locationHref = options.url || operation.target.url;
  let nextTimer = 0;
  const timers = new Map();
  const context = {
    document,
    location: {
      get href() {
        return locationHref;
      },
    },
    getComputedStyle: () => ({ visibility: "visible", display: "block" }),
    InputEvent: class InputEvent {},
    Event: class Event {},
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    setTimeout: (callback) => {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const result = vm.runInNewContext(composerWriteScript(operation), context);
  return {
    editor,
    listeners,
    result,
    setUrl: (url) => {
      locationHref = url;
    },
  };
}

test("the executable write operation mutates only its captured page", () => {
  const operation = createComposerOperation(snapshot(), { text: "translated", send: false });
  const current = runComposerScript(operation);
  assert.deepEqual({ ...current.result }, { ok: true, sent: false });
  assert.equal(current.editor.value, "translated");

  const stale = runComposerScript(operation, { url: "https://chatgpt.com/c/two" });
  assert.deepEqual({ ...stale.result }, { ok: false, reason: "page-changed" });
  assert.equal(stale.editor.value, "");
});

test("the executable send gate accepts one trusted Enter and rejects an untrusted one", () => {
  const acceptedOperation = createComposerOperation(snapshot(), { text: "translated", send: true });
  const accepted = runComposerScript(acceptedOperation);
  assert.equal(accepted.result.armed, true);
  const acceptedEvent = {
    key: "Enter",
    isTrusted: true,
    preventDefault: () => assert.fail("trusted current Enter must not be blocked"),
    stopImmediatePropagation: () => assert.fail("trusted current Enter must not be blocked"),
  };
  accepted.listeners.get("keydown")(acceptedEvent);

  const blockedOperation = createComposerOperation(snapshot(), { text: "translated", send: true });
  const blocked = runComposerScript(blockedOperation);
  let prevented = false;
  blocked.listeners.get("keydown")({
    key: "Enter",
    isTrusted: false,
    preventDefault: () => {
      prevented = true;
    },
    stopImmediatePropagation: () => {},
  });
  assert.equal(prevented, true);
});
