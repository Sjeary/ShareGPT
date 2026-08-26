const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_COMPOSER_CHARS,
  composerClickGuardScript,
  composerInspectionScript,
  hasClearlyNonTargetLanguage,
  installComposerClickGuard,
  isPlainComposerSubmit,
  replaceAiComposerText,
} = require("../aiComposer");

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
  assert.equal(
    isPlainComposerSubmit({ type: "keyDown", key: "Enter", isComposing: true }),
    false,
  );
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

  const result = await installComposerClickGuard(webContents, {
    worldId: 1234,
    enabled: true,
    marker: "__TEST_GUARD__",
  });

  assert.deepEqual(result, ["installed"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 1234);
  assert.match(calls[0][1][0].code, /__TEST_GUARD__/);
  assert.equal(calls[0][2], false);
});

test("composer inspection is a fixed script and never interpolates message text", () => {
  const script = composerInspectionScript(true);
  assert.match(script, /document\.activeElement/);
  assert.match(script, /setSelectionRange/);
  assert.doesNotMatch(script, /user supplied text/);
});

test("click guard runs in a caller-selected isolated world configuration", () => {
  const script = composerClickGuardScript({
    enabled: true,
    targetLanguage: "en",
    marker: "__TEST_GUARD__",
  });
  assert.match(script, /stopImmediatePropagation/);
  assert.match(script, /__TEST_GUARD__/);
  assert.match(script, /targetLanguage = "en"/);
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
