const MAX_COMPOSER_CHARS = 30000;

const NON_LATIN_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}]/u;

function hasClearlyNonTargetLanguage(text, targetLanguage = "en") {
  const value = String(text || "").trim();
  if (!value) return false;

  switch (String(targetLanguage || "en").toLowerCase()) {
    case "en":
      return NON_LATIN_SCRIPT.test(value);
    case "zh":
      return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}]/u.test(
        value,
      );
    case "ja":
      return /[\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}]/u.test(
        value,
      );
    case "ko":
      return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}]/u.test(
        value,
      );
    case "ru":
      return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}]/u.test(
        value,
      );
    default:
      return false;
  }
}

/**
 * @param {boolean | { selectAll?: boolean, findAny?: boolean, focus?: boolean }} options
 */
function composerInspectionScript(options = false) {
  const selectAll = typeof options === "boolean" ? options : Boolean(options.selectAll);
  const findAny = typeof options === "object" && Boolean(options.findAny);
  const focus = typeof options === "object" && Boolean(options.focus);
  return `
    (() => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      if (!(active instanceof Element)) return { editable: false, text: '' };
      const selector = 'textarea, input:not([type]), input[type="text"], input[type="search"], [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
      const editor = (active.matches(selector) ? active : active.closest(selector)) ||
        (${findAny ? "true" : "false"} ? document.querySelector('#prompt-textarea, form textarea, form [contenteditable]:not([contenteditable="false"]), main textarea, main [contenteditable]:not([contenteditable="false"])') : null);
      if (!editor) return { editable: false, text: '' };
      const text = String('value' in editor ? editor.value : editor.innerText || editor.textContent || '').slice(0, ${MAX_COMPOSER_CHARS});
      if (${focus ? "true" : "false"}) editor.focus();
      if (${selectAll ? "true" : "false"}) {
        editor.focus();
        if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
          editor.setSelectionRange(0, editor.value.length);
        } else {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(editor);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      }
      return { editable: true, text };
    })();
  `;
}

function composerClickGuardScript(options = {}) {
  const enabled = options.enabled !== false;
  const targetLanguage = String(options.targetLanguage || "en").toLowerCase();
  const marker = String(options.marker || "__SHAREGPT_COMPOSER_GUARD__");
  return `
    (() => {
      const state = globalThis.__shareGptComposerGuard || {};
      state.enabled = ${JSON.stringify(enabled)};
      state.targetLanguage = ${JSON.stringify(targetLanguage)};
      state.marker = ${JSON.stringify(marker)};
      globalThis.__shareGptComposerGuard = state;
      if (state.installed) return true;
      state.installed = true;
      const editorSelector = '#prompt-textarea, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
      const sendSelector = 'button[data-testid="send-button"], button[aria-label*="Send" i], button[aria-label*="发送"]';
      const clearlyNonTarget = (text, target) => {
        if (target === 'en') return /[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\p{Script=Cyrillic}\\p{Script=Arabic}\\p{Script=Hebrew}\\p{Script=Thai}\\p{Script=Devanagari}]/u.test(text);
        if (target === 'zh') return /[\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\p{Script=Cyrillic}\\p{Script=Arabic}\\p{Script=Hebrew}\\p{Script=Thai}\\p{Script=Devanagari}]/u.test(text);
        if (target === 'ja') return /[\\p{Script=Hangul}\\p{Script=Cyrillic}\\p{Script=Arabic}\\p{Script=Hebrew}\\p{Script=Thai}\\p{Script=Devanagari}]/u.test(text);
        if (target === 'ko') return /[\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Cyrillic}\\p{Script=Arabic}\\p{Script=Hebrew}\\p{Script=Thai}\\p{Script=Devanagari}]/u.test(text);
        if (target === 'ru') return /[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\p{Script=Arabic}\\p{Script=Hebrew}\\p{Script=Thai}\\p{Script=Devanagari}]/u.test(text);
        return false;
      };
      document.addEventListener('click', (event) => {
        const config = globalThis.__shareGptComposerGuard;
        if (!config?.enabled || event.button !== 0) return;
        const button = event.target instanceof Element ? event.target.closest(sendSelector) : null;
        if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
        const form = button.closest('form');
        const active = document.activeElement;
        const editor = form?.querySelector(editorSelector) ||
          (active instanceof Element && active.matches(editorSelector) ? active : null) ||
          document.querySelector(editorSelector);
        if (!editor) return;
        const text = String('value' in editor ? editor.value : editor.innerText || editor.textContent || '').trim().slice(0, ${MAX_COMPOSER_CHARS});
        if (!text || !clearlyNonTarget(text, config.targetLanguage)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        console.log(config.marker + JSON.stringify({ text }));
      }, true);
      return true;
    })();
  `;
}

/**
 * @param {any} webContents
 * @param {{ selectAll?: boolean, findAny?: boolean, focus?: boolean }} options
 */
async function inspectAiComposer(webContents, options = {}) {
  if (!webContents || webContents.isDestroyed()) throw new Error("当前网页尚未打开");
  const result = await webContents.executeJavaScript(composerInspectionScript(options), true);
  return {
    editable: Boolean(result?.editable),
    text: String(result?.text || "").slice(0, MAX_COMPOSER_CHARS),
  };
}

async function replaceAiComposerText(webContents, text) {
  const value = String(text || "").trim();
  if (!value) throw new Error("没有可填入的译文");
  if (value.length > MAX_COMPOSER_CHARS) throw new Error("待发送内容过长");
  const composer = await inspectAiComposer(webContents, { selectAll: true });
  if (!composer.editable) throw new Error("请先在网页中点一下提问输入框");
  webContents.focus();
  await webContents.insertText(value);
  return { ok: true, replacedTextLength: value.length };
}

function sendComposerEnter(webContents) {
  if (!webContents || webContents.isDestroyed()) throw new Error("当前网页尚未打开");
  webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
  webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
}

module.exports = {
  MAX_COMPOSER_CHARS,
  composerClickGuardScript,
  composerInspectionScript,
  hasClearlyNonTargetLanguage,
  inspectAiComposer,
  replaceAiComposerText,
  sendComposerEnter,
};
