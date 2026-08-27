const test = require("node:test");
const assert = require("node:assert/strict");

const {
  COMPOSER_GUARD_CHANNEL_PREFIX,
  MAX_COMPOSER_CHARS,
  assertExpectedComposerContextGeneration,
  composerGuardMarker,
  composerClickGuardScript,
  composerInspectionScript,
  createComposerConfirmationRegistry,
  createComposerGuardToken,
  createOneShotComposerBypass,
  hasClearlyNonTargetLanguage,
  installComposerClickGuard,
  inspectComposerSubmit,
  isPlainComposerSubmit,
  parseComposerGuardConsoleMessage,
  replaceAiComposerText,
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
  assert.throws(() =>
    composerClickGuardScript({ marker: `${COMPOSER_GUARD_CHANNEL_PREFIX}fixed` }),
  );
});

test("composer confirmation registry keeps one pending request per workspace", () => {
  let nextId = 0;
  const registry = createComposerConfirmationRegistry({
    createId: () => `request-${++nextId}`,
    setTimeout: () => ({ unref() {} }),
    clearTimeout: () => {},
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
  assert.equal(registry.take(other.pending.requestId).text, "other");
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

test("composer replacement selects the focused editor then uses native insertText", async () => {
  const inserted = [];
  const webContents = {
    isDestroyed: () => false,
    executeJavaScript: async (script) => {
      assert.match(script, /selection/);
      return { editable: true, text: "old" };
    },
    focus: () => inserted.push("focus"),
    insertText: async (text) => inserted.push(text),
  };
  const result = await replaceAiComposerText(webContents, "Translated prompt");
  assert.deepEqual(inserted, ["focus", "Translated prompt"]);
  assert.deepEqual(result, { ok: true, replacedTextLength: 17 });
});

test("composer replacement rejects oversized text", async () => {
  await assert.rejects(
    replaceAiComposerText({ isDestroyed: () => false }, "x".repeat(MAX_COMPOSER_CHARS + 1)),
    /过长/,
  );
});

test("composer replacement revalidates after deferred inspection before mutating", async () => {
  /** @type {(value: { editable: boolean, text: string }) => void} */
  let resolveInspection = () => {};
  let current = true;
  const inserted = [];
  const webContents = {
    isDestroyed: () => false,
    executeJavaScript: () =>
      new Promise((resolve) => {
        resolveInspection = resolve;
      }),
    focus: () => inserted.push("focus"),
    insertText: async (text) => inserted.push(text),
  };
  const replacement = replaceAiComposerText(webContents, "translated", {
    assertCurrent: () => {
      if (!current) throw new Error("stale context");
    },
  });
  current = false;
  resolveInspection({ editable: true, text: "old" });

  await assert.rejects(replacement, /stale context/);
  assert.deepEqual(inserted, []);
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
