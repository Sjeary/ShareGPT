const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_COMPOSER_CHARS,
  composerClickGuardScript,
  composerInspectionScript,
  hasClearlyNonTargetLanguage,
  replaceAiComposerText,
} = require("../aiComposer");

test("English outgoing guard identifies clearly non-English scripts", () => {
  assert.equal(hasClearlyNonTargetLanguage("请帮我总结这段内容", "en"), true);
  assert.equal(hasClearlyNonTargetLanguage("この文章を要約してください", "en"), true);
  assert.equal(hasClearlyNonTargetLanguage("Please summarize this text.", "en"), false);
  assert.equal(hasClearlyNonTargetLanguage("Explain API v2: 你好", "en"), true);
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
