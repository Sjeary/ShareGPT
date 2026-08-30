const crypto = require("node:crypto");

const COMPOSER_OPERATION_WORLD_ID = 1001;
const COMPOSER_OPERATION_TTL_MS = 1200;
const MAX_COMPOSER_CHARS = 30000;
const TOKEN_PATTERN = /^[a-zA-Z0-9_-]{32,128}$/;
const CONFIRMATION_ID_PATTERN = /^[a-z0-9-]{8,80}$/i;
const COMPOSER_CONFIRMATION_MARKER_PREFIX = "__SHAREGPT_COMPOSER_CONFIRM_V1__:";
const COMPOSER_GUARD_BLOCKED_EVENT = "__sharegpt_internal_composer_blocked_v1";

function safeText(value) {
  return String(value ?? "").trim();
}

function createOperationToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function assertToken(value) {
  const token = safeText(value);
  if (!TOKEN_PATTERN.test(token)) throw new Error("Composer operation token is invalid");
  return token;
}

function normalizeSnapshot(value = {}) {
  return {
    principalId: safeText(value.principalId),
    kind: safeText(value.kind),
    environmentId: safeText(value.environmentId),
    tabId: safeText(value.tabId),
    workspaceInstanceId: safeText(value.workspaceInstanceId),
    webContentsId: Number(value.webContentsId || 0),
    documentEpoch: Number(value.documentEpoch || 0),
    url: safeText(value.url),
  };
}

function createComposerOperation(snapshot, options = {}) {
  const target = normalizeSnapshot(snapshot);
  const text = safeText(options.text);
  if (!target.principalId || !target.kind || !target.tabId || !target.workspaceInstanceId) {
    throw new Error("当前网页尚未准备好");
  }
  if (!Number.isInteger(target.webContentsId) || target.webContentsId < 1) {
    throw new Error("当前网页尚未准备好");
  }
  if (!Number.isInteger(target.documentEpoch) || target.documentEpoch < 1 || !target.url) {
    throw new Error("当前网页仍在导航，请稍后重试");
  }
  if (!text) throw new Error("没有可填入的译文");
  if (text.length > MAX_COMPOSER_CHARS) throw new Error("待发送内容过长");
  return Object.freeze({
    token: createOperationToken(),
    target: Object.freeze(target),
    text,
    send: options.send === true,
  });
}

function composerOperationIsCurrent(operation, snapshot) {
  const current = normalizeSnapshot(snapshot);
  const target = operation?.target || {};
  return Boolean(
    operation &&
    TOKEN_PATTERN.test(safeText(operation.token)) &&
    current.principalId === target.principalId &&
    current.kind === target.kind &&
    current.environmentId === target.environmentId &&
    current.tabId === target.tabId &&
    current.workspaceInstanceId === target.workspaceInstanceId &&
    current.webContentsId === target.webContentsId &&
    current.documentEpoch === target.documentEpoch &&
    current.url === target.url,
  );
}

function assertComposerOperationCurrent(operation, snapshot) {
  if (!composerOperationIsCurrent(operation, snapshot)) {
    throw Object.assign(new Error("网页或标签已经变化，请重新操作"), {
      code: "COMPOSER_TARGET_CHANGED",
    });
  }
  return true;
}

function shouldGuardComposerSubmit(settings) {
  return settings?.translation?.confirmNonTargetSend === true;
}

function hasClearlyNonTargetLanguage(value, targetLanguage) {
  const text = String(value || "").trim();
  const target = String(targetLanguage || "")
    .trim()
    .toLowerCase();
  if (!text || !target) return false;
  const han = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const kana = (text.match(/[\u3040-\u30ff]/g) || []).length;
  const hangul = (text.match(/[\uac00-\ud7af]/g) || []).length;
  const latin = (text.match(/[a-z]/gi) || []).length;
  if (target === "zh") return han === 0 && latin >= 4;
  if (target === "ja") return han + kana === 0 && latin >= 4;
  if (target === "ko") return hangul === 0 && latin >= 4;
  return han >= 2 && latin < 4;
}

function isLikelyComposerEditorInPage(editor, button = null) {
  if (
    !editor?.matches?.(
      'textarea, input:not([type]), input[type="text"], [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
    )
  )
    return false;
  const strongSendSelector =
    'button[data-testid="send-button"], button[data-testid*="send" i], button[aria-label*="send message" i], button[aria-label*="send prompt" i], button[aria-label*="发送消息"]';
  const root = editor.closest?.('form, [data-testid*="composer" i], [class*="composer" i]');
  const rootLooksLikeComposer = root?.matches?.(
    '[data-testid*="composer" i], [class*="composer" i], form[id*="composer" i]',
  );
  const sendButton =
    root?.querySelector?.(strongSendSelector) ||
    (rootLooksLikeComposer ? root?.querySelector?.('button[type="submit"]') : null);
  if (sendButton && (!button || root.contains(button))) return true;
  if (editor.id === "prompt-textarea" || editor.matches?.('[data-lexical-editor="true"]')) {
    const main = editor.closest?.("main") || globalThis.document?.querySelector?.("main");
    return Boolean(main?.querySelector?.(strongSendSelector) && (!button || main.contains(button)));
  }
  return false;
}

function composerConfirmationMarker(token) {
  return `${COMPOSER_CONFIRMATION_MARKER_PREFIX}${assertToken(token)}:`;
}

function composerConfirmationGuardScript(token, options = {}) {
  const marker = composerConfirmationMarker(token);
  const enabled = options.enabled === true;
  const targetLanguage = safeText(options.targetLanguage || "en").toLowerCase();
  const ttlMs = Math.max(1000, Math.min(30000, Number(options.ttlMs) || 15000));
  const key = `__shareGptComposerConfirmation_${assertToken(token)}`;
  const detectSource = hasClearlyNonTargetLanguage.toString();
  const composerEditorSource = isLikelyComposerEditorInPage.toString();
  return `
    (() => {
      'use strict';
      const key = ${JSON.stringify(key)};
      globalThis[key]?.cleanup?.();
      delete globalThis[key];
      if (!${JSON.stringify(enabled)}) return { installed: false };
      const marker = ${JSON.stringify(marker)};
      const targetLanguage = ${JSON.stringify(targetLanguage)};
      const blockedEventName = ${JSON.stringify(COMPOSER_GUARD_BLOCKED_EVENT)};
      const ttlMs = ${ttlMs};
      const hasClearlyNonTargetLanguage = ${detectSource};
      const isLikelyComposerEditor = ${composerEditorSource};
      const selector = 'textarea, input:not([type]), input[type="text"], [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
      const state = {
        pending: new Map(),
        pendingByEditor: new WeakMap(),
        bypass: null,
        consumedReplays: new Map(),
      };
      const read = (editor) => String('value' in editor ? editor.value : editor.innerText || editor.textContent || '').trim();
      const visible = (node) => {
        const rect = node?.getBoundingClientRect?.();
        return Boolean(node?.isConnected && rect && rect.width > 1 && rect.height > 1);
      };
      const findEditor = (target, button = null) => {
        const direct = target?.matches?.(selector) ? target : target?.closest?.(selector);
        const active = document.activeElement;
        const candidates = [direct, active, ...document.querySelectorAll('#prompt-textarea, form textarea, form [contenteditable]:not([contenteditable="false"]), [data-testid*="composer" i] textarea, [data-testid*="composer" i] [contenteditable]:not([contenteditable="false"])')];
        return candidates.find((node) => visible(node) && isLikelyComposerEditor(node, button)) || null;
      };
      const remove = (id) => {
        const pending = state.pending.get(id);
        if (!pending) return null;
        globalThis.clearTimeout(pending.timer);
        state.pending.delete(id);
        if (state.pendingByEditor.get(pending.editor) === id) state.pendingByEditor.delete(pending.editor);
        return pending;
      };
      const block = (event, action, button = null) => {
        const editor = findEditor(action === 'click' ? document.activeElement : event.target, button);
        if (!editor) return;
        if (state.bypass && Date.now() > state.bypass.expiresAt) state.bypass = null;
        if (
          state.bypass && state.bypass.action === action &&
          (state.bypass.editor === editor || (action === 'click' && state.bypass.button === button))
        ) {
          state.consumedReplays.set(state.bypass.id, Date.now() + ttlMs);
          state.bypass = null;
          return;
        }
        const text = read(editor);
        if (!text || !hasClearlyNonTargetLanguage(text, targetLanguage)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        try { editor.dispatchEvent(new Event(blockedEventName)); } catch {}
        if (state.pendingByEditor.has(editor)) return;
        const id = (globalThis.crypto?.randomUUID?.() || (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2))).replace(/_/g, '-');
        const timer = globalThis.setTimeout(() => remove(id), ttlMs);
        state.pending.set(id, { id, editor, button, action, text, url: String(location.href), timer });
        state.pendingByEditor.set(editor, id);
        console.log(marker + JSON.stringify({ id, action, targetLanguage }));
      };
      const keydown = (event) => {
        if (
          event.key !== 'Enter' || event.altKey || event.ctrlKey || event.metaKey ||
          event.shiftKey || event.repeat || event.isComposing
        ) return;
        block(event, 'enter');
      };
      const click = (event) => {
        const button = event.target?.closest?.('button[data-testid="send-button"], button[aria-label*="Send" i], button[aria-label*="发送"]');
        if (button) block(event, 'click', button);
      };
      state.resolve = (id, confirmed) => {
        const pending = remove(id);
        if (!pending) return { ok: false, reason: 'expired' };
        if (!confirmed) return { ok: true, replay: '' };
        if (
          String(location.href) !== pending.url || !visible(pending.editor) ||
          read(pending.editor) !== pending.text
        ) return { ok: false, reason: 'page-changed' };
        if (pending.action === 'click') {
          if (!visible(pending.button)) return { ok: false, reason: 'button-changed' };
          state.bypass = { ...pending, expiresAt: Date.now() + 500 };
          pending.button.click();
          return { ok: true, replay: 'click', replayId: pending.id };
        }
        state.bypass = { ...pending, expiresAt: Date.now() + 500 };
        pending.editor.focus();
        return { ok: true, replay: 'enter', replayId: pending.id };
      };
      state.finalize = (id, force = false) => {
        const now = Date.now();
        for (const [replayId, expiresAt] of state.consumedReplays) {
          if (expiresAt <= now) state.consumedReplays.delete(replayId);
        }
        if (state.consumedReplays.has(id)) {
          state.consumedReplays.delete(id);
          return { ok: true, consumed: true };
        }
        if (state.bypass?.id === id) {
          if (force) state.bypass = null;
          return { ok: true, consumed: false, forced: Boolean(force) };
        }
        return { ok: false, consumed: false, reason: 'expired' };
      };
      state.cleanup = () => {
        document.removeEventListener('keydown', keydown, true);
        document.removeEventListener('click', click, true);
        for (const pending of state.pending.values()) globalThis.clearTimeout(pending.timer);
        state.pending.clear();
        state.bypass = null;
        state.consumedReplays.clear();
      };
      document.addEventListener('keydown', keydown, true);
      document.addEventListener('click', click, true);
      globalThis[key] = state;
      return { installed: true, targetLanguage };
    })();
  `;
}

function composerConfirmationFinalizeScript(token, requestId, force = false) {
  const key = `__shareGptComposerConfirmation_${assertToken(token)}`;
  const id = safeText(requestId);
  if (!CONFIRMATION_ID_PATTERN.test(id)) throw new Error("发送确认已失效");
  return `(() => globalThis[${JSON.stringify(key)}]?.finalize?.(${JSON.stringify(id)}, ${JSON.stringify(Boolean(force))}) || ({ ok: false, consumed: false }))();`;
}

async function readComposerConfirmationReplay(webContents, token, requestId, options = {}) {
  if (!webContents || webContents.isDestroyed?.()) {
    return { ok: false, consumed: false, reason: "destroyed" };
  }
  return webContents.executeJavaScriptInIsolatedWorld(
    Number(options.worldId || COMPOSER_OPERATION_WORLD_ID),
    [{ code: composerConfirmationFinalizeScript(token, requestId, options.force === true) }],
    false,
  );
}

async function waitForComposerConfirmationReplay(webContents, token, requestId, options = {}) {
  const attempts = Math.max(1, Math.min(50, Number(options.attempts) || 20));
  const intervalMs = Math.max(1, Math.min(50, Number(options.intervalMs) || 10));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await readComposerConfirmationReplay(webContents, token, requestId, options);
    if (result?.consumed === true) return result;
    if (result?.ok === false) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  await readComposerConfirmationReplay(webContents, token, requestId, {
    ...options,
    force: true,
  }).catch(() => undefined);
  return { ok: false, consumed: false, reason: "replay-timeout" };
}

function parseComposerConfirmationMessage(message, token) {
  const marker = composerConfirmationMarker(token);
  const value = String(message || "");
  if (!value.startsWith(marker)) return null;
  try {
    const payload = JSON.parse(value.slice(marker.length));
    const id = safeText(payload?.id);
    const action = safeText(payload?.action);
    const targetLanguage = safeText(payload?.targetLanguage).toLowerCase();
    if (
      !CONFIRMATION_ID_PATTERN.test(id) ||
      !["enter", "click"].includes(action) ||
      !/^[a-z-]{2,12}$/.test(targetLanguage)
    )
      return null;
    const keys = Object.keys(payload || {})
      .sort()
      .join(",");
    if (keys !== "action,id,targetLanguage") return null;
    return { id, action, targetLanguage };
  } catch {
    return null;
  }
}

function composerConfirmationResolveScript(token, requestId, confirmed) {
  const key = `__shareGptComposerConfirmation_${assertToken(token)}`;
  const id = safeText(requestId);
  if (!CONFIRMATION_ID_PATTERN.test(id)) throw new Error("发送确认已失效");
  return `(() => globalThis[${JSON.stringify(key)}]?.resolve?.(${JSON.stringify(id)}, ${JSON.stringify(Boolean(confirmed))}) || ({ ok: false, reason: 'expired' }))();`;
}

function createComposerConfirmationStore(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const ttlMs = Math.max(1000, Number(options.ttlMs) || 15000);
  const entries = new Map();
  const purge = () => {
    const current = now();
    for (const [id, entry] of entries) if (entry.expiresAt <= current) entries.delete(id);
  };
  return {
    put(id, value) {
      purge();
      const key = safeText(id);
      if (!CONFIRMATION_ID_PATTERN.test(key)) return null;
      const entry = Object.freeze({ ...value, requestId: key, expiresAt: now() + ttlMs });
      entries.set(key, entry);
      return entry;
    },
    take(id) {
      purge();
      const key = safeText(id);
      const entry = entries.get(key) || null;
      entries.delete(key);
      return entry;
    },
    deleteFor(predicate) {
      const removed = [];
      for (const [id, entry] of entries) {
        if (!predicate(entry)) continue;
        entries.delete(id);
        removed.push(entry);
      }
      return removed;
    },
    clear() {
      entries.clear();
    },
  };
}

function serializeScriptData(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function composerWriteScript(operation, options = {}) {
  const token = assertToken(operation?.token);
  const target = normalizeSnapshot(operation?.target);
  const text = safeText(operation?.text);
  if (!target.url || !text || text.length > MAX_COMPOSER_CHARS) {
    throw new Error("Composer operation payload is invalid");
  }
  const payload = serializeScriptData({
    token,
    url: target.url,
    text,
    send: operation.send === true,
    ttlMs: Math.max(100, Math.min(3000, Number(options.ttlMs) || COMPOSER_OPERATION_TTL_MS)),
  });
  const composerEditorSource = isLikelyComposerEditorInPage.toString();
  return `
    (() => {
      'use strict';
      const payload = Object.freeze(${payload});
      const currentUrl = () => String(globalThis.location?.href || '');
      if (currentUrl() !== payload.url) return { ok: false, reason: 'page-changed' };

      const isLikelyComposerEditor = ${composerEditorSource};
      const selector = 'textarea, input:not([type]), input[type="text"], [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
      const deepActive = () => {
        let active = document.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        return active;
      };
      const visible = (node) => {
        if (!node?.isConnected) return false;
        const rect = node.getBoundingClientRect?.();
        const style = globalThis.getComputedStyle?.(node);
        return Boolean(rect && rect.width > 1 && rect.height > 1 && style?.visibility !== 'hidden' && style?.display !== 'none');
      };
      const active = deepActive();
      const candidates = [
        active?.matches?.(selector) ? active : active?.closest?.(selector),
        ...document.querySelectorAll('#prompt-textarea, form textarea, form [contenteditable]:not([contenteditable="false"]), [data-testid*="composer" i] textarea, [data-testid*="composer" i] [contenteditable]:not([contenteditable="false"])'),
      ];
      const editor = candidates.find((node) => visible(node) && isLikelyComposerEditor(node));
      if (!editor) return { ok: false, reason: 'no-editor' };

      const read = () => String('value' in editor ? editor.value : editor.innerText || editor.textContent || '').trim();
      const inputEvent = (type, init) => {
        try {
          return new InputEvent(type, init);
        } catch {
          return new Event(type, {
            bubbles: Boolean(init?.bubbles),
            cancelable: Boolean(init?.cancelable),
            composed: Boolean(init?.composed),
          });
        }
      };
      editor.focus();
      if (currentUrl() !== payload.url) return { ok: false, reason: 'page-changed' };
      const beforeInput = inputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        composed: true,
        data: payload.text,
        inputType: 'insertReplacementText',
      });
      if ('value' in editor) {
        editor.setSelectionRange?.(0, String(editor.value || '').length);
        if (!editor.dispatchEvent(beforeInput)) return { ok: false, reason: 'write-cancelled' };
        const prototype = Object.getPrototypeOf(editor);
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (setter) setter.call(editor, payload.text);
        else editor.value = payload.text;
        editor.setSelectionRange?.(payload.text.length, payload.text.length);
      } else {
        if (!editor.isContentEditable) return { ok: false, reason: 'no-editor' };
        const selection = globalThis.getSelection?.();
        const range = document.createRange?.();
        range?.selectNodeContents(editor);
        selection?.removeAllRanges();
        if (range) selection?.addRange(range);
        if (!editor.dispatchEvent(beforeInput)) return { ok: false, reason: 'write-cancelled' };
        let inserted = false;
        try {
          inserted = Boolean(document.execCommand?.('insertText', false, payload.text));
        } catch {}
        if (!inserted) editor.replaceChildren(document.createTextNode(payload.text));
        const finalRange = document.createRange?.();
        finalRange?.selectNodeContents(editor);
        finalRange?.collapse(false);
        selection?.removeAllRanges();
        if (finalRange) selection?.addRange(finalRange);
      }
      editor.dispatchEvent(inputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertReplacementText',
        data: payload.text,
      }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      if (currentUrl() !== payload.url || read() !== payload.text) {
        return { ok: false, reason: 'write-rejected' };
      }
      if (!payload.send) return { ok: true, sent: false };

      const prior = globalThis.__shareGptOneShotComposerOperation;
      prior?.cleanup?.('replaced');
      const state = {
        token: payload.token,
        url: payload.url,
        editor,
        expectedText: payload.text,
        status: 'armed',
        reason: '',
        timer: null,
        listener: null,
      };
      const cleanup = (reason) => {
        if (state.listener) globalThis.removeEventListener('keydown', state.listener, true);
        if (state.timer) globalThis.clearTimeout(state.timer);
        state.listener = null;
        state.timer = null;
        if (reason && state.status === 'armed') {
          state.status = 'blocked';
          state.reason = reason;
        }
      };
      state.cleanup = cleanup;
      state.listener = (event) => {
        if (event.key !== 'Enter' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || event.isComposing) return;
        const focused = deepActive();
        const reason =
          !event.isTrusted ? 'untrusted' :
          currentUrl() !== state.url ? 'page-changed' :
          !state.editor.isConnected ? 'editor-removed' :
          !(focused === state.editor || state.editor.contains?.(focused)) ? 'focus-changed' :
          read() !== state.expectedText ? 'text-changed' : '';
        state.status = reason ? 'blocked' : 'accepted';
        state.reason = reason;
        cleanup('');
        if (reason) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      };
      globalThis.addEventListener('keydown', state.listener, true);
      state.timer = globalThis.setTimeout(() => cleanup('timeout'), payload.ttlMs);
      globalThis.__shareGptOneShotComposerOperation = state;
      return { ok: true, sent: false, armed: true, token: payload.token };
    })();
  `;
}

function composerOutcomeScript(token) {
  const expected = assertToken(token);
  return `
    (() => {
      const state = globalThis.__shareGptOneShotComposerOperation;
      if (!state || state.token !== ${JSON.stringify(expected)}) {
        return { token: ${JSON.stringify(expected)}, status: 'missing', reason: 'not-found' };
      }
      return { token: state.token, status: state.status, reason: String(state.reason || '') };
    })();
  `;
}

async function executeComposerWrite(webContents, operation, options = {}) {
  if (!webContents || webContents.isDestroyed?.()) throw new Error("当前网页尚未打开");
  const result = await webContents.executeJavaScriptInIsolatedWorld(
    Number(options.worldId || COMPOSER_OPERATION_WORLD_ID),
    [{ code: composerWriteScript(operation, options) }],
    false,
  );
  if (!result?.ok) {
    const message =
      result?.reason === "no-editor" ? "请先点击网页输入框" : "网页已经变化，请重新操作";
    throw Object.assign(new Error(message), { code: "COMPOSER_WRITE_REJECTED" });
  }
  return result;
}

function sendComposerEnter(webContents) {
  if (!webContents || webContents.isDestroyed?.()) throw new Error("当前网页尚未打开");
  webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
  webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
}

async function readComposerOutcome(webContents, token, options = {}) {
  if (!webContents || webContents.isDestroyed?.()) {
    return { token: safeText(token), status: "missing", reason: "destroyed" };
  }
  return webContents.executeJavaScriptInIsolatedWorld(
    Number(options.worldId || COMPOSER_OPERATION_WORLD_ID),
    [{ code: composerOutcomeScript(token) }],
    false,
  );
}

async function waitForComposerOutcome(webContents, token, options = {}) {
  const attempts = Math.max(1, Math.min(50, Number(options.attempts) || 20));
  const intervalMs = Math.max(1, Math.min(50, Number(options.intervalMs) || 10));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await readComposerOutcome(webContents, token, options);
    if (result?.status !== "armed") return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { token: safeText(token), status: "blocked", reason: "outcome-timeout" };
}

module.exports = {
  COMPOSER_GUARD_BLOCKED_EVENT,
  COMPOSER_OPERATION_TTL_MS,
  COMPOSER_OPERATION_WORLD_ID,
  MAX_COMPOSER_CHARS,
  assertComposerOperationCurrent,
  composerConfirmationFinalizeScript,
  composerConfirmationGuardScript,
  composerConfirmationMarker,
  composerConfirmationResolveScript,
  composerOperationIsCurrent,
  composerOutcomeScript,
  composerWriteScript,
  createComposerConfirmationStore,
  createComposerOperation,
  createOperationToken,
  executeComposerWrite,
  hasClearlyNonTargetLanguage,
  isLikelyComposerEditorInPage,
  parseComposerConfirmationMessage,
  readComposerConfirmationReplay,
  readComposerOutcome,
  sendComposerEnter,
  shouldGuardComposerSubmit,
  waitForComposerOutcome,
  waitForComposerConfirmationReplay,
};
