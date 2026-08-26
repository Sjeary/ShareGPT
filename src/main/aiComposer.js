const crypto = require("node:crypto");

const MAX_COMPOSER_CHARS = 30000;
const COMPOSER_GUARD_CHANNEL_PREFIX = "__SHAREGPT_COMPOSER_GUARD_V2__:";
const COMPOSER_GUARD_TOKEN_PATTERN = /^[a-zA-Z0-9_-]{32,128}$/;

const NON_LATIN_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}]/u;

function hasClearlyNonTargetLanguage(text, targetLanguage = "en") {
  const value = String(text || "").trim();
  if (!value) return false;

  switch (String(targetLanguage || "en").toLowerCase()) {
    case "en":
    case "fr":
    case "de":
    case "es":
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

function isPlainComposerSubmit(input) {
  return Boolean(
    input &&
    input.type === "keyDown" &&
    input.key === "Enter" &&
    !input.alt &&
    !input.control &&
    !input.meta &&
    !input.shift &&
    !input.isAutoRepeat &&
    !input.isComposing,
  );
}

function createComposerGuardToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function composerGuardMarker(token) {
  const value = String(token || "");
  if (!COMPOSER_GUARD_TOKEN_PATTERN.test(value)) {
    throw new Error("Composer guard token is invalid");
  }
  return `${COMPOSER_GUARD_CHANNEL_PREFIX}${value}:`;
}

function parseComposerGuardConsoleMessage(message, expectedToken) {
  const value = String(message || "");
  if (!value.startsWith(COMPOSER_GUARD_CHANNEL_PREFIX)) return { kind: "other" };

  let marker;
  try {
    marker = composerGuardMarker(expectedToken);
  } catch {
    return { kind: "invalid" };
  }
  if (!value.startsWith(marker) || value.length > marker.length + MAX_COMPOSER_CHARS + 100) {
    return { kind: "invalid" };
  }

  try {
    const payload = JSON.parse(value.slice(marker.length));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { kind: "invalid" };
    }
    const keys = Object.keys(payload);
    if (keys.length !== 1 || keys[0] !== "text" || typeof payload.text !== "string") {
      return { kind: "invalid" };
    }
    const text = payload.text.trim();
    if (!text || text.length > MAX_COMPOSER_CHARS) return { kind: "invalid" };
    return { kind: "valid", text };
  } catch {
    return { kind: "invalid" };
  }
}

function createComposerConfirmationRegistry(options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? Math.max(1, Number(options.ttlMs)) : 120000;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const createId = typeof options.createId === "function" ? options.createId : crypto.randomUUID;
  const schedule = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const cancel = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
  const onExpire = typeof options.onExpire === "function" ? options.onExpire : () => {};
  const byId = new Map();
  const byWorkspace = new Map();

  function remove(requestId) {
    const pending = byId.get(requestId);
    if (!pending) return null;
    byId.delete(requestId);
    if (byWorkspace.get(pending.workspaceId) === requestId) {
      byWorkspace.delete(pending.workspaceId);
    }
    if (pending.timer) cancel(pending.timer);
    return pending;
  }

  function get(requestId) {
    const pending = byId.get(String(requestId || ""));
    if (!pending) return null;
    if (pending.expiresAt <= now()) {
      const expired = remove(pending.requestId);
      if (expired) onExpire(expired);
      return null;
    }
    return pending;
  }

  function invalidateWorkspace(workspaceId) {
    const requestId = byWorkspace.get(String(workspaceId || ""));
    return requestId ? remove(requestId) : null;
  }

  return {
    queue(workspaceId, payload) {
      const key = String(workspaceId || "");
      if (!key) throw new Error("Composer workspace is required");
      const replaced = invalidateWorkspace(key);
      const requestId = String(createId());
      const expiresAt = now() + ttlMs;
      const pending = { ...payload, workspaceId: key, requestId, expiresAt, timer: null };
      pending.timer = schedule(() => {
        const current = byId.get(requestId);
        if (current !== pending) return;
        const expired = remove(requestId);
        if (expired) onExpire(expired);
      }, ttlMs);
      pending.timer?.unref?.();
      byId.set(requestId, pending);
      byWorkspace.set(key, requestId);
      return { pending, replaced };
    },
    get,
    take(requestId) {
      const pending = get(requestId);
      return pending ? remove(pending.requestId) : null;
    },
    invalidateWorkspace,
    clear() {
      const removed = [...byId.keys()].map(remove).filter(Boolean);
      return removed;
    },
    size() {
      return byId.size;
    },
  };
}

function createOneShotComposerBypass(options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? Math.max(1, Number(options.ttlMs)) : 500;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const schedule = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const cancel = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
  const createToken =
    typeof options.createToken === "function" ? options.createToken : crypto.randomUUID;
  let armed = null;

  function clear() {
    if (!armed) return false;
    if (armed.timer) cancel(armed.timer);
    armed = null;
    return true;
  }

  return {
    arm(contextGeneration) {
      clear();
      const token = String(createToken());
      const expiresAt = now() + ttlMs;
      const entry = {
        token,
        contextGeneration: Number(contextGeneration || 0),
        expiresAt,
        timer: null,
      };
      entry.timer = schedule(() => {
        if (armed?.token === token) clear();
      }, ttlMs);
      entry.timer?.unref?.();
      armed = entry;
      return token;
    },
    consume(contextGeneration) {
      if (
        !armed ||
        armed.expiresAt <= now() ||
        armed.contextGeneration !== Number(contextGeneration || 0)
      ) {
        clear();
        return false;
      }
      clear();
      return true;
    },
    clear,
    isArmed() {
      return Boolean(armed && armed.expiresAt > now());
    },
  };
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
  const marker = String(options.marker || "");
  const markerToken = marker.endsWith(":")
    ? marker.slice(COMPOSER_GUARD_CHANNEL_PREFIX.length, -1)
    : "";
  if (
    !marker.startsWith(COMPOSER_GUARD_CHANNEL_PREFIX) ||
    !COMPOSER_GUARD_TOKEN_PATTERN.test(markerToken) ||
    marker !== composerGuardMarker(markerToken)
  ) {
    throw new Error("Authenticated composer guard marker is required");
  }
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
        if (['en', 'fr', 'de', 'es'].includes(target)) return /[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\p{Script=Cyrillic}\\p{Script=Arabic}\\p{Script=Hebrew}\\p{Script=Thai}\\p{Script=Devanagari}]/u.test(text);
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

async function installComposerClickGuard(webContents, options = {}) {
  if (!webContents || webContents.isDestroyed()) throw new Error("当前网页尚未打开");
  const worldId = Number.isInteger(options.worldId) ? options.worldId : 1001;
  return webContents.executeJavaScriptInIsolatedWorld(
    worldId,
    [{ code: composerClickGuardScript(options) }],
    false,
  );
}

async function disableComposerClickGuard(webContents, worldId = 1001) {
  if (!webContents || webContents.isDestroyed()) return false;
  await webContents.executeJavaScriptInIsolatedWorld(
    worldId,
    [
      {
        code: `(() => {
          const state = globalThis.__shareGptComposerGuard;
          if (!state) return false;
          state.enabled = false;
          state.marker = '';
          return true;
        })();`,
      },
    ],
    false,
  );
  return true;
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

async function inspectComposerSubmit(webContents, targetLanguage, options = {}) {
  const assertCurrent =
    typeof options.assertCurrent === "function" ? options.assertCurrent : () => undefined;
  assertCurrent();
  const composer = await inspectAiComposer(webContents);
  assertCurrent();
  const text = String(composer.text || "").trim();
  return {
    action:
      composer.editable && text && hasClearlyNonTargetLanguage(text, targetLanguage)
        ? "confirm"
        : "replay",
    text,
  };
}

async function replaceAiComposerText(webContents, text, options = {}) {
  const value = String(text || "").trim();
  if (!value) throw new Error("没有可填入的译文");
  if (value.length > MAX_COMPOSER_CHARS) throw new Error("待发送内容过长");
  const assertCurrent =
    typeof options.assertCurrent === "function" ? options.assertCurrent : () => undefined;
  assertCurrent();
  const composer = await inspectAiComposer(webContents, { selectAll: true });
  assertCurrent();
  if (!composer.editable) throw new Error("请先在网页中点一下提问输入框");
  assertCurrent();
  webContents.focus();
  assertCurrent();
  await webContents.insertText(value);
  assertCurrent();
  return { ok: true, replacedTextLength: value.length };
}

function sendComposerEnter(webContents) {
  if (!webContents || webContents.isDestroyed()) throw new Error("当前网页尚未打开");
  webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
  webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
}

module.exports = {
  COMPOSER_GUARD_CHANNEL_PREFIX,
  MAX_COMPOSER_CHARS,
  composerGuardMarker,
  composerClickGuardScript,
  composerInspectionScript,
  createComposerConfirmationRegistry,
  createComposerGuardToken,
  createOneShotComposerBypass,
  disableComposerClickGuard,
  hasClearlyNonTargetLanguage,
  installComposerClickGuard,
  inspectAiComposer,
  inspectComposerSubmit,
  isPlainComposerSubmit,
  parseComposerGuardConsoleMessage,
  replaceAiComposerText,
  sendComposerEnter,
};
