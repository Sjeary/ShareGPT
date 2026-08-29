const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const {
  COMPOSER_GUARD_CHANNEL_PREFIX,
  COMPOSER_ISOLATED_WORLD_ID,
  MAX_COMPOSER_CHARS,
  SELECTION_TRANSLATION_CHANNEL_PREFIX,
  assertExpectedComposerContextGeneration,
  composerGuardMarker,
  composerClickGuardScript,
  composerDocumentNonceScript,
  composerInspectionScript,
  composerMutationScript,
  createComposerConfirmationRegistry,
  createComposerDocumentNonce,
  createComposerGuardToken,
  createOneShotComposerBypass,
  createSelectionTranslationRateLimiter,
  hasClearlyNonTargetLanguage,
  installComposerDocumentNonce,
  installComposerClickGuard,
  inspectComposerSubmit,
  isPlainComposerSubmit,
  parseComposerGuardConsoleMessage,
  parseSelectionTranslationConsoleMessage,
  replaceAiComposerText,
  selectionTranslationMarker,
  selectionTranslationScript,
} = require("../aiComposer");

test("main process rejects stale composer navigation generations", () => {
  const workspace = { composerContextGeneration: 4 };
  assert.equal(assertExpectedComposerContextGeneration(workspace, 4), 4);
  assert.throws(() => assertExpectedComposerContextGeneration(workspace, 3), {
    code: "COMPOSER_CONTEXT_STALE",
    message: "网页导航上下文已失效",
  });
  assert.throws(() => assertExpectedComposerContextGeneration(workspace, undefined), {
    code: "COMPOSER_CONTEXT_STALE",
  });
});

test("English outgoing guard identifies clearly non-English scripts", () => {
  assert.equal(hasClearlyNonTargetLanguage("请帮我总结这段内容", "en"), true);
  assert.equal(hasClearlyNonTargetLanguage("この文章を要約してください", "en"), true);
  assert.equal(hasClearlyNonTargetLanguage("Please summarize this text.", "en"), false);
  assert.equal(hasClearlyNonTargetLanguage("Explain API v2: 你好", "en"), true);
});

test("non-Latin text is also guarded for supported Latin-script targets", () => {
  assert.equal(hasClearlyNonTargetLanguage("中文问题", "fr"), true);
  assert.equal(hasClearlyNonTargetLanguage("English question", "de"), false);
});

test("plain composer submit excludes IME composition and modified Enter", () => {
  assert.equal(isPlainComposerSubmit({ type: "keyDown", key: "Enter" }), true);
  assert.equal(isPlainComposerSubmit({ type: "keyDown", key: "Enter", isComposing: true }), false);
  assert.equal(isPlainComposerSubmit({ type: "keyDown", key: "Enter", shift: true }), false);
});

test("installs the click guard through the webContents isolated-world API", async () => {
  const calls = [];
  const webContents = {
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: async (...args) => {
      calls.push(args);
      return ["installed"];
    },
    mainFrame: {
      executeJavaScriptInIsolatedWorld: () => {
        throw new Error("wrong API");
      },
    },
  };

  const token = createComposerGuardToken();
  const marker = composerGuardMarker(token);
  const result = await installComposerClickGuard(webContents, {
    worldId: 1234,
    enabled: true,
    marker,
  });

  assert.deepEqual(result, ["installed"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 1234);
  assert.match(calls[0][1][0].code, new RegExp(token));
  assert.equal(calls[0][2], false);
});

test("composer inspection is a fixed script and never interpolates message text", () => {
  const script = composerInspectionScript(true);
  assert.match(script, /document\.activeElement/);
  assert.match(script, /setSelectionRange/);
  assert.doesNotMatch(script, /user supplied text/);
});

test("click guard runs in a caller-selected isolated world configuration", () => {
  const marker = composerGuardMarker(createComposerGuardToken());
  const script = composerClickGuardScript({
    enabled: true,
    targetLanguage: "en",
    marker,
  });
  assert.match(script, /stopImmediatePropagation/);
  assert.match(script, /!event\.isTrusted/);
  assert.ok(script.includes(marker));
  assert.match(script, /targetLanguage = "en"/);
});

test("composer guard messages require the exact workspace token and strict payload", () => {
  const token = createComposerGuardToken();
  const otherToken = createComposerGuardToken();
  const marker = composerGuardMarker(token);
  assert.match(token, /^[a-zA-Z0-9_-]{32,128}$/);
  assert.notEqual(token, otherToken);
  assert.deepEqual(parseComposerGuardConsoleMessage("normal log", token), { kind: "other" });
  assert.deepEqual(
    parseComposerGuardConsoleMessage(`${composerGuardMarker(otherToken)}{"text":"forged"}`, token),
    { kind: "invalid" },
  );
  assert.deepEqual(parseComposerGuardConsoleMessage(`${marker}{`, token), { kind: "invalid" });
  assert.deepEqual(parseComposerGuardConsoleMessage(`${marker}{"text":""}`, token), {
    kind: "invalid",
  });
  assert.deepEqual(
    parseComposerGuardConsoleMessage(`${marker}{"text":"hello","extra":true}`, token),
    { kind: "invalid" },
  );
  assert.deepEqual(parseComposerGuardConsoleMessage(`${marker}{"text":"  hello  "}`, token), {
    kind: "valid",
    text: "hello",
  });
  assert.deepEqual(parseComposerGuardConsoleMessage(`${marker}{"tooLong":true}`, token), {
    kind: "too-long",
  });
  assert.throws(() =>
    composerClickGuardScript({ marker: `${COMPOSER_GUARD_CHANNEL_PREFIX}fixed` }),
  );
});

function selectionMessagePayload(overrides = {}) {
  return {
    text: "selected text",
    documentNonce: createComposerDocumentNonce(),
    documentUrl: "https://chatgpt.com/c/one",
    navigationGeneration: 4,
    principalId: "server-principal",
    principalGeneration: 7,
    environmentId: "environment-one",
    environmentGeneration: 3,
    ...overrides,
  };
}

test("selection translation messages require the exact token and bound context", () => {
  const token = createComposerGuardToken();
  const otherToken = createComposerGuardToken();
  const marker = selectionTranslationMarker(token);
  const payload = selectionMessagePayload();
  assert.equal(marker, `${SELECTION_TRANSLATION_CHANNEL_PREFIX}${token}:`);
  assert.deepEqual(parseSelectionTranslationConsoleMessage("normal log", token), {
    kind: "other",
  });
  assert.deepEqual(
    parseSelectionTranslationConsoleMessage(
      `${selectionTranslationMarker(otherToken)}${JSON.stringify(payload)}`,
      token,
    ),
    { kind: "invalid" },
  );
  assert.deepEqual(
    parseSelectionTranslationConsoleMessage(
      `${marker}${JSON.stringify({ ...payload, extra: true })}`,
      token,
    ),
    { kind: "invalid" },
  );
  assert.deepEqual(
    parseSelectionTranslationConsoleMessage(
      `${marker}${JSON.stringify({ ...payload, documentNonce: "forged" })}`,
      token,
    ),
    { kind: "invalid" },
  );
  assert.deepEqual(
    parseSelectionTranslationConsoleMessage(
      `${marker}${JSON.stringify({ ...payload, text: { value: "not a string" } })}`,
      token,
    ),
    { kind: "invalid" },
  );
  assert.deepEqual(
    parseSelectionTranslationConsoleMessage(
      `${marker}${JSON.stringify({ ...payload, text: "x".repeat(MAX_COMPOSER_CHARS + 1) })}`,
      token,
    ),
    { kind: "invalid" },
  );
  assert.deepEqual(
    parseSelectionTranslationConsoleMessage(`${marker}${JSON.stringify(payload)}`, token),
    { kind: "valid", ...payload },
  );
});

test("selection translation rate limit is per-instance, deduplicates, and clears", () => {
  let now = 1000;
  const first = createSelectionTranslationRateLimiter({ now: () => now });
  const second = createSelectionTranslationRateLimiter({ now: () => now });
  assert.equal(first.accept("one", "nonce"), true);
  assert.equal(second.accept("one", "nonce"), true, "another workspace has an independent limit");
  now += 100;
  assert.equal(first.accept("two", "nonce"), false, "the workspace rate limit applies");
  now += 300;
  assert.equal(first.accept("one", "nonce"), false, "recent duplicate text is suppressed");
  assert.equal(first.accept("two", "nonce"), true);
  first.clear();
  assert.equal(first.accept("two", "nonce"), true, "lifecycle invalidation clears limiter state");
});

function createSelectionTranslationHarness(options = {}) {
  const documentListeners = {};
  const globalListeners = {};
  const timers = new Map();
  const logs = [];
  let nextTimerId = 1;
  class TestElement {
    constructor(document, parentNode = null, editable = false) {
      this.ownerDocument = document;
      this.parentNode = parentNode;
      this.isConnected = true;
      this.isContentEditable = editable;
    }

    matches(selector) {
      return this.isContentEditable && selector.includes("textarea");
    }

    getAttribute() {
      return this.isContentEditable ? "true" : null;
    }
  }
  const document = {
    addEventListener(type, listener) {
      documentListeners[type] = listener;
    },
  };
  const common = new TestElement(document, document, Boolean(options.editable));
  const anchor = {
    ownerDocument: document,
    parentNode: common,
    isConnected: true,
  };
  const focus = {
    ownerDocument: document,
    parentNode: common,
    isConnected: true,
  };
  const selectionRects = options.rects || [{ left: 10, right: 110, top: 10, bottom: 30 }];
  const selection = {
    isCollapsed: true,
    rangeCount: 1,
    anchorNode: anchor,
    focusNode: focus,
    getRangeAt: () => ({
      commonAncestorContainer: common,
      getClientRects: () => selectionRects,
    }),
    toString: () => options.text || "Selected passage",
  };
  const context = {
    Element: TestElement,
    document,
    location: { href: "https://chatgpt.com/c/one" },
    getSelection: () => selection,
    console: { log: (message) => logs.push(message) },
    addEventListener(type, listener) {
      globalListeners[type] = listener;
    },
    setTimeout(listener) {
      const id = nextTimerId++;
      timers.set(id, listener);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  context.window = context;
  const nonce = createComposerDocumentNonce();
  const token = createComposerGuardToken();
  vm.runInNewContext(composerDocumentNonceScript(nonce), context);
  vm.runInNewContext(
    selectionTranslationScript({
      enabled: true,
      marker: selectionTranslationMarker(token),
      documentNonce: nonce,
      documentUrl: context.location.href,
      navigationGeneration: 4,
      principalId: "principal-one",
      principalGeneration: 7,
      environmentId: "environment-one",
      environmentGeneration: 3,
      debounceMs: 150,
    }),
    context,
  );
  return {
    context,
    documentListeners,
    globalListeners,
    logs,
    nonce,
    selection,
    timers,
    token,
  };
}

function authorizePointerSelection(harness) {
  const { documentListeners, selection } = harness;
  selection.isCollapsed = true;
  documentListeners.pointerdown({
    isTrusted: true,
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: 12,
    clientY: 20,
  });
  selection.isCollapsed = false;
  documentListeners.selectionchange({ isTrusted: true });
  documentListeners.pointerup({
    isTrusted: true,
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: 100,
    clientY: 20,
    detail: 1,
  });
}

test("selectionchange only updates a candidate; a bound trusted drag authorizes publication", () => {
  const harness = createSelectionTranslationHarness();
  const { documentListeners, logs, nonce, selection, timers, token } = harness;
  selection.isCollapsed = false;
  documentListeners.selectionchange({ isTrusted: true });
  assert.equal(timers.size, 0, "selectionchange cannot authorize a message");
  documentListeners.pointerup({
    isTrusted: false,
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: 100,
    clientY: 20,
  });
  assert.equal(timers.size, 0, "a synthetic pointer event cannot authorize a message");
  authorizePointerSelection(harness);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(logs.length, 1);
  assert.deepEqual(parseSelectionTranslationConsoleMessage(logs[0], token), {
    kind: "valid",
    ...selectionMessagePayload({
      text: "Selected passage",
      documentNonce: nonce,
      navigationGeneration: 4,
      principalId: "principal-one",
      environmentId: "environment-one",
    }),
  });
});

test("selection translation drops an authorized candidate if the page changes the selection", () => {
  const harness = createSelectionTranslationHarness();
  const { documentListeners, logs, selection, timers } = harness;
  authorizePointerSelection(harness);
  const queuedPublish = [...timers.values()][0];
  selection.toString = () => "Page-replaced selection";
  documentListeners.selectionchange({ isTrusted: false });
  queuedPublish();
  assert.deepEqual(logs, []);
});

test("trusted pointer gestures cannot authorize a selection outside the dragged pixels", () => {
  const harness = createSelectionTranslationHarness({
    rects: [{ left: 500, right: 600, top: 500, bottom: 520 }],
  });
  authorizePointerSelection(harness);
  assert.equal(harness.timers.size, 0);
  assert.deepEqual(harness.logs, []);
});

test("pointer cancellation clears a pending trusted selection gesture", () => {
  const { documentListeners, selection, timers } = createSelectionTranslationHarness();
  documentListeners.pointerdown({
    isTrusted: true,
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: 12,
    clientY: 20,
  });
  documentListeners.pointercancel({ isTrusted: true, pointerId: 1 });
  selection.isCollapsed = false;
  documentListeners.selectionchange({ isTrusted: true });
  documentListeners.pointerup({
    isTrusted: true,
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: 100,
    clientY: 20,
    detail: 1,
  });
  assert.equal(timers.size, 0);
});

test("selection translation ignores editable ancestors and untrusted keyboard events", () => {
  const harness = createSelectionTranslationHarness({ editable: true });
  const { documentListeners, logs, selection, timers } = harness;
  documentListeners.keyup({
    isTrusted: false,
    key: "ArrowRight",
    shiftKey: true,
    altKey: false,
  });
  selection.isCollapsed = false;
  authorizePointerSelection(harness);
  assert.equal(timers.size, 0);
  assert.deepEqual(logs, []);
});

test("only keyboard gestures that can create a selection authorize publication", () => {
  const { documentListeners, logs, selection, timers } = createSelectionTranslationHarness();
  documentListeners.keyup({
    isTrusted: true,
    key: "ArrowRight",
    shiftKey: false,
    altKey: false,
  });
  assert.equal(timers.size, 0);
  documentListeners.keydown({
    isTrusted: true,
    key: "ArrowRight",
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
  });
  selection.isCollapsed = false;
  documentListeners.selectionchange({ isTrusted: true });
  documentListeners.keyup({
    isTrusted: true,
    key: "ArrowRight",
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
  });
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(logs.length, 1);
});

test("document navigation immediately invalidates an authorized selection", () => {
  const harness = createSelectionTranslationHarness();
  const { context, globalListeners, logs, timers } = harness;
  authorizePointerSelection(harness);
  assert.equal(timers.size, 1);
  const queuedPublish = [...timers.values()][0];
  globalListeners.pagehide();
  assert.equal(timers.size, 0);
  assert.equal(context.__shareGptSelectionTranslation.enabled, false);
  queuedPublish();
  assert.deepEqual(logs, []);
});

test("disabling selection translation cancels an already authorized publication", () => {
  const harness = createSelectionTranslationHarness();
  const { context, logs, nonce, timers, token } = harness;
  authorizePointerSelection(harness);
  assert.equal(timers.size, 1);
  const queuedPublish = [...timers.values()][0];
  vm.runInNewContext(
    selectionTranslationScript({
      enabled: false,
      marker: selectionTranslationMarker(token),
      documentNonce: nonce,
      documentUrl: context.location.href,
      navigationGeneration: 4,
      principalId: "principal-one",
      principalGeneration: 7,
      environmentId: "environment-one",
      environmentGeneration: 3,
    }),
    context,
  );
  assert.equal(timers.size, 0);
  assert.equal(context.__shareGptSelectionTranslation.enabled, false);
  queuedPublish();
  assert.deepEqual(logs, []);
});

test("composer confirmation registry keeps one pending request per workspace", () => {
  let nextId = 0;
  const taken = [];
  const registry = createComposerConfirmationRegistry({
    createId: () => `request-${++nextId}`,
    setTimeout: () => ({ unref() {} }),
    clearTimeout: () => {},
    onTake: (pending, reason) => taken.push([pending.requestId, reason]),
  });
  const first = registry.queue("gpt:tab-a", { text: "first" });
  const second = registry.queue("gpt:tab-a", { text: "second" });
  const other = registry.queue("gpt:tab-b", { text: "other" });

  assert.equal(first.replaced, null);
  assert.equal(second.replaced.requestId, "request-1");
  assert.equal(registry.get("request-1"), null);
  assert.equal(registry.get("request-2").text, "second");
  assert.equal(registry.get("request-3").text, "other");
  assert.equal(registry.size(), 2);
  assert.equal(registry.invalidateWorkspace("gpt:tab-a").requestId, "request-2");
  assert.equal(registry.size(), 1);
  assert.equal(registry.take(other.pending.requestId, "confirmed").text, "other");
  assert.deepEqual(taken, [["request-3", "confirmed"]]);
  assert.equal(registry.size(), 0);
});

test("composer confirmation registry expires and clears requests", () => {
  let currentTime = 100;
  const expired = [];
  const registry = createComposerConfirmationRegistry({
    ttlMs: 10,
    now: () => currentTime,
    createId: () => "request-expiring",
    setTimeout: () => ({ unref() {} }),
    clearTimeout: () => {},
    onExpire: (pending) => expired.push(pending.requestId),
  });
  registry.queue("gpt:tab-a", { text: "expires" });
  currentTime = 111;
  assert.equal(registry.get("request-expiring"), null);
  assert.deepEqual(expired, ["request-expiring"]);
  assert.equal(registry.size(), 0);
});

test("a newer workspace confirmation invalidates a deferred old resolve", async () => {
  let nextId = 0;
  const registry = createComposerConfirmationRegistry({
    createId: () => `request-${++nextId}`,
    setTimeout: () => ({ unref() {} }),
    clearTimeout: () => {},
  });
  const old = registry.queue("gpt:tab-a", { text: "old" }).pending;
  let resumeInspection = () => {};
  const inspection = new Promise((resolve) => {
    resumeInspection = () => resolve();
  });
  const sent = [];
  const deferredResolve = (async () => {
    assert.equal(registry.get(old.requestId), old);
    await inspection;
    if (registry.take(old.requestId)) sent.push(old.text);
  })();
  const current = registry.queue("gpt:tab-a", { text: "new" }).pending;
  resumeInspection();
  await deferredResolve;
  assert.deepEqual(sent, []);
  assert.equal(registry.get(current.requestId), current);
});

test("composer replay bypass survives deferred delivery, is one-shot, and expires", () => {
  let currentTime = 10;
  /** @type {Function} */
  let scheduled = () => {};
  const bypass = createOneShotComposerBypass({
    ttlMs: 25,
    now: () => currentTime,
    createToken: () => "bypass-token",
    setTimeout: (callback) => {
      scheduled = callback;
      return { unref() {} };
    },
    clearTimeout: () => {},
  });
  bypass.arm(3);
  assert.equal(bypass.isArmed(), true);
  assert.equal(bypass.consume(2), false, "an old context cannot consume the bypass");
  bypass.arm(3);
  currentTime = 20;
  assert.equal(bypass.consume(3), true, "deferred synthetic Enter consumes the bypass");
  assert.equal(bypass.consume(3), false, "the bypass cannot be reused");
  bypass.arm(4);
  currentTime = 36;
  scheduled();
  assert.equal(bypass.consume(4), false, "expired bypasses fail closed");
});

test("composer document nonce installs navigation invalidation in the fixed isolated world", async () => {
  const nonce = createComposerDocumentNonce();
  const calls = [];
  const webContents = {
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: async (...args) => {
      calls.push(args);
      return { ok: true, nonce, url: "https://chatgpt.com/c/one" };
    },
  };

  const result = await installComposerDocumentNonce(webContents, { nonce });
  assert.deepEqual(result, { nonce, url: "https://chatgpt.com/c/one" });
  assert.equal(calls[0][0], COMPOSER_ISOLATED_WORLD_ID);
  const script = calls[0][1][0].code;
  assert.match(script, /navigation\?\.addEventListener\?\.\('navigate'/);
  assert.match(script, /addEventListener\?\.\('pagehide'/);
  assert.match(script, /addEventListener\?\.\('hashchange'/);
  assert.match(script, /addEventListener\?\.\('popstate'/);
});

test("composer mutation rejects a new document and same-document URL changes", () => {
  const nonce = createComposerDocumentNonce();
  const url = "https://chatgpt.com/c/one";
  const script = composerMutationScript({ documentNonce: nonce, documentUrl: url, text: "hello" });
  const newDocument = { location: { href: url } };
  const newDocumentResult = vm.runInNewContext(script, newDocument);
  assert.equal(newDocumentResult.ok, false);
  assert.equal(newDocumentResult.reason, "stale-document");

  const sameDocument = {
    location: { href: "https://chatgpt.com/c/two" },
    __shareGptComposerDocument: { nonce, url },
  };
  const sameDocumentResult = vm.runInNewContext(script, sameDocument);
  assert.equal(sameDocumentResult.ok, false);
  assert.equal(sameDocumentResult.reason, "stale-document");
});

test("composer document listeners synchronously invalidate an old SPA nonce", () => {
  const nonce = createComposerDocumentNonce();
  const listeners = {};
  const context = {
    location: { href: "https://chatgpt.com/c/one" },
    navigation: {
      addEventListener: (type, listener) => {
        listeners[type] = listener;
      },
    },
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
  };
  vm.runInNewContext(composerDocumentNonceScript(nonce), context);
  assert.equal(context.__shareGptComposerDocument.nonce, nonce);
  listeners.navigate();
  assert.equal(context.__shareGptComposerDocument.nonce, "");
  assert.equal(context.__shareGptComposerDocument.url, "");
  const result = vm.runInNewContext(
    composerMutationScript({
      documentNonce: nonce,
      documentUrl: context.location.href,
      text: "must not write",
    }),
    context,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "stale-document");
});

function createEnterGateHarness() {
  const listeners = {};
  const timers = new Map();
  let nextTimerId = 1;
  const url = "https://chatgpt.com/c/one";
  const nonce = createComposerDocumentNonce();
  const editor = {
    isConnected: true,
    value: "translated",
    contains(node) {
      return node === this;
    },
  };
  const document = { activeElement: editor };
  const context = {
    location: { href: url },
    document,
    navigation: {
      addEventListener: (type, listener) => {
        listeners[type] = listener;
      },
    },
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
    setTimeout: (listener) => {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, listener);
      return timerId;
    },
    clearTimeout: (timerId) => timers.delete(timerId),
  };
  vm.runInNewContext(composerDocumentNonceScript(nonce), context);
  return { context, document, editor, listeners, nonce, timers, url };
}

function createPlainEnterEvent() {
  return {
    key: "Enter",
    isTrusted: true,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {
      this.propagationStopped = true;
    },
  };
}

test("composer Enter gate permits one native Enter for the bound editor", () => {
  const { context, editor, listeners, nonce, url } = createEnterGateHarness();
  const token = createComposerGuardToken();
  assert.equal(
    context.__shareGptComposerDocument.armEnterGate({
      token,
      nonce,
      url,
      editor,
      expectedText: "translated",
      ttlMs: 1000,
    }),
    true,
  );

  const first = createPlainEnterEvent();
  listeners.keydown(first);
  assert.equal(first.defaultPrevented, false);
  assert.equal(first.propagationStopped, false);
  assert.deepEqual(
    { ...context.__shareGptComposerDocument.enterGateOutcome },
    { token, status: "allowed", reason: "" },
  );
  assert.equal(context.__shareGptComposerDocument.enterGate, null);

  const second = createPlainEnterEvent();
  listeners.keydown(second);
  assert.equal(
    second.defaultPrevented,
    false,
    "the consumed gate does not intercept later user input",
  );
  assert.deepEqual(
    { ...context.__shareGptComposerDocument.enterGateOutcome },
    { token, status: "allowed", reason: "" },
  );
});

test("composer Enter gate blocks a queued send after focus moves", () => {
  const { context, document, editor, listeners, nonce, url } = createEnterGateHarness();
  const token = createComposerGuardToken();
  context.__shareGptComposerDocument.armEnterGate({
    token,
    nonce,
    url,
    editor,
    expectedText: "translated",
    ttlMs: 1000,
  });
  document.activeElement = { isConnected: true, value: "other", contains: () => false };

  const event = createPlainEnterEvent();
  listeners.keydown(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(
    { ...context.__shareGptComposerDocument.enterGateOutcome },
    { token, status: "blocked", reason: "focus-changed" },
  );
  assert.equal(context.__shareGptComposerDocument.enterGate, null);
});

test("composer Enter gate ignores untrusted page-generated Enter events", () => {
  const { context, editor, listeners, nonce, url } = createEnterGateHarness();
  const token = createComposerGuardToken();
  context.__shareGptComposerDocument.armEnterGate({
    token,
    nonce,
    url,
    editor,
    expectedText: "translated",
    ttlMs: 1000,
  });

  const forged = createPlainEnterEvent();
  forged.isTrusted = false;
  listeners.keydown(forged);
  assert.equal(forged.defaultPrevented, false);
  assert.equal(context.__shareGptComposerDocument.enterGate?.token, token);
  assert.deepEqual(
    { ...context.__shareGptComposerDocument.enterGateOutcome },
    { token, status: "pending", reason: "" },
  );

  const native = createPlainEnterEvent();
  listeners.keydown(native);
  assert.equal(native.defaultPrevented, false);
  assert.deepEqual(
    { ...context.__shareGptComposerDocument.enterGateOutcome },
    { token, status: "allowed", reason: "" },
  );
});

test("composer Enter gate expiry fail-closes a delayed native Enter", () => {
  const { context, editor, listeners, nonce, timers, url } = createEnterGateHarness();
  const token = createComposerGuardToken();
  context.__shareGptComposerDocument.armEnterGate({
    token,
    nonce,
    url,
    editor,
    expectedText: "translated",
    ttlMs: 1000,
  });
  assert.equal(timers.size, 1);
  const expire = [...timers.values()][0];
  expire();
  assert.deepEqual(
    { ...context.__shareGptComposerDocument.enterGateOutcome },
    { token, status: "expired", reason: "timeout" },
  );
  assert.equal(context.__shareGptComposerDocument.enterGate?.token, token);

  const delayed = createPlainEnterEvent();
  listeners.keydown(delayed);
  assert.equal(delayed.defaultPrevented, true);
  assert.equal(delayed.propagationStopped, true);
  assert.deepEqual(
    { ...context.__shareGptComposerDocument.enterGateOutcome },
    { token, status: "blocked", reason: "expired" },
  );
  assert.equal(context.__shareGptComposerDocument.enterGate, null);
});

test("composer Enter gate blocks a queued send after the page changes the bound text", () => {
  const { context, editor, listeners, nonce, url } = createEnterGateHarness();
  const token = createComposerGuardToken();
  assert.equal(
    context.__shareGptComposerDocument.armEnterGate({
      token,
      nonce,
      url,
      editor,
      expectedText: "translated",
      ttlMs: 1000,
    }),
    true,
  );
  editor.value = "page replacement";

  const event = createPlainEnterEvent();
  listeners.keydown(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(
    { ...context.__shareGptComposerDocument.enterGateOutcome },
    { token, status: "blocked", reason: "text-changed" },
  );
});

test("composer Enter gate rejects a hidden suffix beyond the maximum inspected length", () => {
  const { context, editor, nonce, url } = createEnterGateHarness();
  const expectedText = "x".repeat(MAX_COMPOSER_CHARS);
  editor.value = `${expectedText}hidden suffix`;
  assert.equal(
    context.__shareGptComposerDocument.armEnterGate({
      token: createComposerGuardToken(),
      nonce,
      url,
      editor,
      expectedText,
      ttlMs: 1000,
    }),
    false,
  );
});

test("composer mutation serializes hostile text as data and keeps mutation in one task", () => {
  const nonce = createComposerDocumentNonce();
  const url = "https://chatgpt.com/c/one";
  const hostile = `</script>"; globalThis.__shareGptInjected = true; //\u2028下一行`;
  const script = composerMutationScript({
    documentNonce: nonce,
    documentUrl: url,
    text: hostile,
  });
  const context = {
    location: { href: "https://chatgpt.com/c/two" },
    __shareGptComposerDocument: { nonce, url },
  };
  const result = vm.runInNewContext(script, context);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "stale-document");
  assert.equal(context.__shareGptInjected, undefined);
  assert.ok(!script.includes("</script>"));
  assert.match(script, /HTMLInputElement\.prototype/);
  assert.match(script, /HTMLTextAreaElement\.prototype/);
  assert.match(script, /setter\.call\(editor, payload\.text\)/);
  assert.match(script, /'beforeinput'/);
  assert.match(script, /'input'/);
  assert.match(script, /execCommand\?\.\('insertText'/);
  assert.match(script, /replaceChildren\(document\.createTextNode\(payload\.text\)\)/);
});

function runInputMutationWithReentry(reentryType) {
  class FakeElement {
    constructor(ownerDocument) {
      this.ownerDocument = ownerDocument;
      this.isConnected = true;
      this.isContentEditable = false;
      this._value = "old";
      /** @type {FakeElement | null} */
      this.replacement = null;
    }
    matches() {
      return true;
    }
    closest() {
      return this;
    }
    contains(node) {
      return node === this;
    }
    focus() {
      this.ownerDocument.activeElement = this;
    }
    setSelectionRange() {}
    dispatchEvent(event) {
      if (reentryType === "input-text" && event.type === "input") {
        this._value += " page suffix";
      }
      if (event.type === reentryType) {
        if (reentryType === "beforeinput") this.isConnected = false;
        this.ownerDocument.activeElement = this.replacement;
      }
      return true;
    }
  }
  class FakeInput extends FakeElement {}
  class FakeTextArea extends FakeElement {}
  for (const prototype of [FakeInput.prototype, FakeTextArea.prototype]) {
    Object.defineProperty(prototype, "value", {
      configurable: true,
      get() {
        return this._value;
      },
      set(value) {
        this._value = value;
      },
    });
  }
  class FakeEvent {
    constructor(type, options = {}) {
      this.type = type;
      Object.assign(this, options);
    }
  }

  const url = "https://chatgpt.com/c/one";
  const nonce = createComposerDocumentNonce();
  const document = { activeElement: null };
  const original = new FakeInput(document);
  const replacement = new FakeInput(document);
  original.replacement = replacement;
  document.activeElement = original;
  const result = vm.runInNewContext(
    composerMutationScript({ documentNonce: nonce, documentUrl: url, text: "translated" }),
    {
      location: { href: url },
      __shareGptComposerDocument: { nonce, url },
      document,
      Element: FakeElement,
      HTMLInputElement: FakeInput,
      HTMLTextAreaElement: FakeTextArea,
      InputEvent: FakeEvent,
      Event: FakeEvent,
    },
  );
  return { original, replacement, result };
}

test("composer mutation does not write after beforeinput replaces the focused editor", () => {
  const { original, replacement, result } = runInputMutationWithReentry("beforeinput");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "stale-editor");
  assert.equal(original._value, "old");
  assert.equal(replacement._value, "old");
});

test("composer mutation cannot report success after input moves focus to another editor", () => {
  const { original, replacement, result } = runInputMutationWithReentry("input");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "stale-editor");
  assert.equal(original._value, "translated");
  assert.equal(replacement._value, "old");
});

test("composer mutation cannot arm Enter after an input handler changes the inserted text", () => {
  const { original, replacement, result } = runInputMutationWithReentry("input-text");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "text-changed");
  assert.equal(original._value, "translated page suffix");
  assert.equal(replacement._value, "old");
});

test("composer replacement runs the fixed isolated-world atomic mutation", async () => {
  const nonce = createComposerDocumentNonce();
  const calls = [];
  const focused = [];
  const webContents = {
    isDestroyed: () => false,
    focus: () => focused.push(true),
    executeJavaScriptInIsolatedWorld: async (...args) => {
      calls.push(args);
      return { ok: true, replacedTextLength: 17 };
    },
  };
  const result = await replaceAiComposerText(webContents, "Translated prompt", {
    documentNonce: nonce,
    documentUrl: "https://chatgpt.com/c/one",
  });
  assert.deepEqual(focused, [true]);
  assert.equal(calls[0][0], COMPOSER_ISOLATED_WORLD_ID);
  assert.equal(calls[0][1].length, 1);
  assert.deepEqual(result, { ok: true, replacedTextLength: 17 });
});

test("composer replacement rejects oversized text", async () => {
  await assert.rejects(
    replaceAiComposerText({ isDestroyed: () => false }, "x".repeat(MAX_COMPOSER_CHARS + 1)),
    /过长/,
  );
});

test("composer replacement fails closed when the isolated document nonce is stale", async () => {
  const nonce = createComposerDocumentNonce();
  const webContents = {
    isDestroyed: () => false,
    focus: () => {},
    executeJavaScriptInIsolatedWorld: async () => ({ ok: false, reason: "stale-document" }),
  };
  await assert.rejects(
    replaceAiComposerText(webContents, "translated", {
      documentNonce: nonce,
      documentUrl: "https://chatgpt.com/c/one",
    }),
    { code: "COMPOSER_DOCUMENT_STALE" },
  );
});

test("composer inspection rejection fails closed without replaying Enter", async () => {
  const sent = [];
  const webContents = {
    isDestroyed: () => false,
    executeJavaScript: async () => {
      throw new Error("inspection unavailable");
    },
    sendInputEvent: (event) => sent.push(event),
  };
  await assert.rejects(inspectComposerSubmit(webContents, "en"), /inspection unavailable/);
  assert.deepEqual(sent, []);
});

test("composer inspection rejects content longer than the authenticated limit", async () => {
  const webContents = {
    isDestroyed: () => false,
    executeJavaScript: async () => ({
      editable: true,
      text: "x".repeat(MAX_COMPOSER_CHARS),
      tooLong: true,
    }),
  };
  await assert.rejects(inspectComposerSubmit(webContents, "en"), /内容过长/);
});
