const crypto = require("node:crypto");

const MAX_COMPOSER_CHARS = 30000;
const COMPOSER_GUARD_CHANNEL_PREFIX = "__SHAREGPT_COMPOSER_GUARD_V2__:";
const SELECTION_TRANSLATION_CHANNEL_PREFIX = "__SHAREGPT_SELECTION_TRANSLATION_V2__:";
const COMPOSER_GUARD_TOKEN_PATTERN = /^[a-zA-Z0-9_-]{32,128}$/;
const COMPOSER_ISOLATED_WORLD_ID = 1001;
const COMPOSER_ENTER_GATE_TTL_MS = 1000;

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

function createComposerDocumentNonce() {
  return crypto.randomBytes(32).toString("base64url");
}

function createComposerEnterGateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function serializeComposerScriptData(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function assertComposerDocumentNonce(nonce) {
  const value = String(nonce || "");
  if (!COMPOSER_GUARD_TOKEN_PATTERN.test(value)) {
    throw new Error("Composer document nonce is invalid");
  }
  return value;
}

function composerDocumentNonceScript(nonce) {
  const payload = serializeComposerScriptData({ nonce: assertComposerDocumentNonce(nonce) });
  return `
    (() => {
      'use strict';
      const payload = Object.freeze(${payload});
      const state = globalThis.__shareGptComposerDocument || {
        nonce: '',
        url: '',
        enterGate: null,
        enterGateOutcome: null,
        listenersInstalled: false,
      };
      globalThis.__shareGptComposerDocument = state;
      const finishEnterGate = (token, status, reason) => {
        const gate = state.enterGate;
        if (!gate || gate.token !== token) return false;
        if (gate.timer) globalThis.clearTimeout?.(gate.timer);
        gate.timer = null;
        // Keep an expired gate long enough to fail-close a native Enter that was already
        // queued by the main process but reached the renderer after the deadline.
        if (status === 'expired') gate.expired = true;
        else state.enterGate = null;
        state.enterGateOutcome = { token, status, reason: String(reason || '') };
        return true;
      };
      const invalidateEnterGate = (reason) => {
        const gate = state.enterGate;
        return gate ? finishEnterGate(gate.token, 'blocked', reason) : false;
      };
      const deepActiveElement = () => {
        let active = document.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        return active;
      };
      state.armEnterGate = (gate) => {
        invalidateEnterGate('replaced');
        if (
          !gate ||
          state.nonce !== gate.nonce ||
          state.url !== gate.url ||
          String(globalThis.location?.href || '') !== gate.url ||
          !gate.editor?.isConnected
        ) {
          return false;
        }
        const entry = {
          token: gate.token,
          nonce: gate.nonce,
          url: gate.url,
          editor: gate.editor,
          expiresAt: Date.now() + gate.ttlMs,
          timer: null,
        };
        state.enterGate = entry;
        state.enterGateOutcome = { token: entry.token, status: 'pending', reason: '' };
        entry.timer = globalThis.setTimeout?.(() => {
          if (state.enterGate === entry) finishEnterGate(entry.token, 'expired', 'timeout');
        }, gate.ttlMs);
        return true;
      };
      state.invalidateEnterGate = invalidateEnterGate;
      if (!state.listenersInstalled) {
        const invalidate = () => {
          invalidateEnterGate('navigation');
          globalThis.__shareGptSelectionTranslation?.invalidate?.('navigation');
          state.nonce = '';
          state.url = '';
        };
        globalThis.navigation?.addEventListener?.('navigate', invalidate);
        globalThis.addEventListener?.('pagehide', invalidate, true);
        globalThis.addEventListener?.('hashchange', invalidate, true);
        globalThis.addEventListener?.('popstate', invalidate, true);
        globalThis.addEventListener?.('keydown', (event) => {
          const gate = state.enterGate;
          if (
            !gate ||
            !event.isTrusted ||
            event.key !== 'Enter' ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.repeat ||
            event.isComposing
          ) {
            return;
          }
          const active = deepActiveElement();
          const reason =
            gate.expired || gate.expiresAt <= Date.now()
              ? 'expired'
              : state.nonce !== gate.nonce ||
                  state.url !== gate.url ||
                  String(globalThis.location?.href || '') !== gate.url
                ? 'stale-document'
                : !gate.editor?.isConnected
                  ? 'detached-editor'
                  : !(active === gate.editor || gate.editor.contains?.(active))
                    ? 'focus-changed'
                    : '';
          const allowed = !reason;
          finishEnterGate(gate.token, allowed ? 'allowed' : 'blocked', reason);
          if (!allowed) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        }, true);
        state.listenersInstalled = true;
      }
      invalidateEnterGate('identity-replaced');
      globalThis.__shareGptSelectionTranslation?.invalidate?.('identity-replaced');
      state.nonce = payload.nonce;
      state.url = String(globalThis.location?.href || '');
      return { ok: true, nonce: state.nonce, url: state.url };
    })();
  `;
}

function composerMutationScript(options = {}) {
  const nonce = assertComposerDocumentNonce(options.documentNonce);
  const documentUrl = String(options.documentUrl || "");
  const text = String(options.text || "");
  if (!documentUrl || documentUrl.length > 10000) {
    throw new Error("Composer document URL is invalid");
  }
  if (!text.trim()) throw new Error("没有可填入的译文");
  if (text.length > MAX_COMPOSER_CHARS) throw new Error("待发送内容过长");
  const enterGateToken = options.enterGateToken
    ? assertComposerDocumentNonce(options.enterGateToken)
    : "";
  const enterGateTtlMs = Math.min(
    COMPOSER_ENTER_GATE_TTL_MS,
    Math.max(50, Number(options.enterGateTtlMs) || COMPOSER_ENTER_GATE_TTL_MS),
  );
  const payload = serializeComposerScriptData({
    nonce,
    documentUrl,
    text,
    enterGateToken,
    enterGateTtlMs,
  });
  return `
    (() => {
      'use strict';
      const payload = Object.freeze(${payload});
      const state = globalThis.__shareGptComposerDocument;
      const documentIsCurrent = () => Boolean(
        state &&
        state.nonce === payload.nonce &&
        state.url === payload.documentUrl &&
        String(globalThis.location?.href || '') === payload.documentUrl
      );
      if (!documentIsCurrent()) {
        return { ok: false, reason: 'stale-document' };
      }

      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      if (!(active instanceof Element)) return { ok: false, reason: 'no-editor' };
      const selector = 'textarea, input:not([type]), input[type="text"], input[type="search"], [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
      const editor = active.matches(selector) ? active : active.closest(selector);
      if (!editor) return { ok: false, reason: 'no-editor' };
      const editorOwnsFocus = () => {
        let focused = document.activeElement;
        while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
        return Boolean(
          documentIsCurrent() &&
          editor.isConnected &&
          focused instanceof Element &&
          (focused === editor || editor.contains(focused))
        );
      };

      const inputEvent = (type, options) => {
        try {
          return new InputEvent(type, options);
        } catch {
          return new Event(type, {
            bubbles: Boolean(options?.bubbles),
            cancelable: Boolean(options?.cancelable),
            composed: Boolean(options?.composed),
          });
        }
      };
      const beforeInput = inputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        composed: true,
        data: payload.text,
        inputType: 'insertReplacementText',
      });

      editor.focus();
      if (!editorOwnsFocus()) return { ok: false, reason: 'stale-editor' };
      if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
        editor.setSelectionRange(0, editor.value.length);
        if (!editor.dispatchEvent(beforeInput)) {
          return { ok: false, reason: 'beforeinput-cancelled' };
        }
        if (!editorOwnsFocus()) return { ok: false, reason: 'stale-editor' };
        const prototype = editor instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (typeof setter !== 'function') return { ok: false, reason: 'mutation-failed' };
        setter.call(editor, payload.text);
        editor.setSelectionRange(payload.text.length, payload.text.length);
        editor.dispatchEvent(inputEvent('input', {
          bubbles: true,
          composed: true,
          data: payload.text,
          inputType: 'insertReplacementText',
        }));
        if (!editorOwnsFocus()) return { ok: false, reason: 'stale-editor' };
        if (
          payload.enterGateToken &&
          !state.armEnterGate?.({
            token: payload.enterGateToken,
            nonce: payload.nonce,
            url: payload.documentUrl,
            editor,
            ttlMs: payload.enterGateTtlMs,
          })
        ) {
          return { ok: false, reason: 'enter-gate-unavailable' };
        }
        return {
          ok: true,
          replacedTextLength: payload.text.length,
          enterGateToken: payload.enterGateToken,
        };
      }

      if (!editor.isContentEditable) return { ok: false, reason: 'no-editor' };
      const selection = globalThis.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (!editor.dispatchEvent(beforeInput)) {
        return { ok: false, reason: 'beforeinput-cancelled' };
      }
      if (!editorOwnsFocus()) return { ok: false, reason: 'stale-editor' };

      let sawInput = false;
      const markInput = () => {
        sawInput = true;
      };
      editor.addEventListener('input', markInput);
      let inserted = false;
      try {
        inserted = Boolean(document.execCommand?.('insertText', false, payload.text));
      } catch {}
      editor.removeEventListener('input', markInput);
      if (!inserted) editor.replaceChildren(document.createTextNode(payload.text));
      const finalRange = document.createRange();
      finalRange.selectNodeContents(editor);
      finalRange.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(finalRange);
      if (!sawInput) {
        editor.dispatchEvent(inputEvent('input', {
          bubbles: true,
          composed: true,
          data: payload.text,
          inputType: 'insertReplacementText',
        }));
      }
      if (!editorOwnsFocus()) return { ok: false, reason: 'stale-editor' };
      if (
        payload.enterGateToken &&
        !state.armEnterGate?.({
          token: payload.enterGateToken,
          nonce: payload.nonce,
          url: payload.documentUrl,
          editor,
          ttlMs: payload.enterGateTtlMs,
        })
      ) {
        return { ok: false, reason: 'enter-gate-unavailable' };
      }
      return {
        ok: true,
        replacedTextLength: payload.text.length,
        enterGateToken: payload.enterGateToken,
      };
    })();
  `;
}

function composerEnterGateArmScript(options = {}) {
  const nonce = assertComposerDocumentNonce(options.documentNonce);
  const token = assertComposerDocumentNonce(options.token);
  const documentUrl = String(options.documentUrl || "");
  const expectedText = String(options.expectedText || "")
    .trim()
    .slice(0, MAX_COMPOSER_CHARS);
  const findAny = Boolean(options.findAny);
  const ttlMs = Math.min(
    COMPOSER_ENTER_GATE_TTL_MS,
    Math.max(50, Number(options.ttlMs) || COMPOSER_ENTER_GATE_TTL_MS),
  );
  const payload = serializeComposerScriptData({
    nonce,
    token,
    documentUrl,
    expectedText,
    findAny,
    ttlMs,
  });
  return `
    (() => {
      'use strict';
      const payload = Object.freeze(${payload});
      const state = globalThis.__shareGptComposerDocument;
      if (
        !state ||
        state.nonce !== payload.nonce ||
        state.url !== payload.documentUrl ||
        String(globalThis.location?.href || '') !== payload.documentUrl ||
        typeof state.armEnterGate !== 'function'
      ) {
        return { ok: false, status: 'blocked', reason: 'stale-document' };
      }
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      const selector = 'textarea, input:not([type]), input[type="text"], input[type="search"], [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
      let editor = active instanceof Element
        ? (active.matches(selector) ? active : active.closest(selector))
        : null;
      if (!editor && payload.findAny) {
        editor = document.querySelector('#prompt-textarea, form textarea, form [contenteditable]:not([contenteditable="false"]), main textarea, main [contenteditable]:not([contenteditable="false"])');
      }
      if (!editor?.isConnected) {
        return { ok: false, status: 'blocked', reason: 'no-editor' };
      }
      if (payload.findAny) editor.focus();
      let focused = document.activeElement;
      while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
      if (!(focused === editor || editor.contains?.(focused))) {
        return { ok: false, status: 'blocked', reason: 'focus-changed' };
      }
      const text = String('value' in editor ? editor.value : editor.innerText || editor.textContent || '').trim().slice(0, ${MAX_COMPOSER_CHARS});
      if (payload.expectedText && text !== payload.expectedText) {
        return { ok: false, status: 'blocked', reason: 'text-changed' };
      }
      if (!state.armEnterGate({
        token: payload.token,
        nonce: payload.nonce,
        url: payload.documentUrl,
        editor,
        ttlMs: payload.ttlMs,
      })) {
        return { ok: false, status: 'blocked', reason: 'gate-unavailable' };
      }
      return { ok: true, token: payload.token, status: 'pending', reason: '' };
    })();
  `;
}

function composerEnterGateOutcomeScript(token) {
  const payload = serializeComposerScriptData({ token: assertComposerDocumentNonce(token) });
  return `
    (() => {
      'use strict';
      const payload = Object.freeze(${payload});
      const state = globalThis.__shareGptComposerDocument;
      if (!state) return { token: payload.token, status: 'unknown', reason: 'no-document' };
      const outcome = state.enterGateOutcome;
      if (!outcome || outcome.token !== payload.token) {
        return { token: payload.token, status: 'unknown', reason: 'token-mismatch' };
      }
      return {
        token: payload.token,
        status: String(outcome.status || 'unknown'),
        reason: String(outcome.reason || ''),
      };
    })();
  `;
}

function composerDocumentInvalidateScript(options = {}) {
  const nonce = options.documentNonce ? assertComposerDocumentNonce(options.documentNonce) : "";
  const reason = String(options.reason || "invalidated").slice(0, 100);
  const payload = serializeComposerScriptData({ nonce, reason });
  return `
    (() => {
      'use strict';
      const payload = Object.freeze(${payload});
      const state = globalThis.__shareGptComposerDocument;
      if (!state || (payload.nonce && state.nonce !== payload.nonce)) return false;
      state.invalidateEnterGate?.(payload.reason);
      globalThis.__shareGptSelectionTranslation?.invalidate?.(payload.reason);
      state.nonce = '';
      state.url = '';
      return true;
    })();
  `;
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

function selectionTranslationMarker(token) {
  const value = String(token || "");
  if (!COMPOSER_GUARD_TOKEN_PATTERN.test(value)) {
    throw new Error("Selection translation token is invalid");
  }
  return `${SELECTION_TRANSLATION_CHANNEL_PREFIX}${value}:`;
}

function parseSelectionTranslationConsoleMessage(message, expectedToken) {
  const value = String(message || "");
  if (!value.startsWith(SELECTION_TRANSLATION_CHANNEL_PREFIX)) return { kind: "other" };

  let marker;
  try {
    marker = selectionTranslationMarker(expectedToken);
  } catch {
    return { kind: "invalid" };
  }
  if (!value.startsWith(marker) || value.length > marker.length + MAX_COMPOSER_CHARS + 12000) {
    return { kind: "invalid" };
  }

  try {
    const payload = JSON.parse(value.slice(marker.length));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { kind: "invalid" };
    }
    const expectedKeys = [
      "documentNonce",
      "documentUrl",
      "environmentGeneration",
      "environmentId",
      "navigationGeneration",
      "principalGeneration",
      "principalId",
      "text",
    ];
    if (
      Object.keys(payload).sort().join("\0") !== expectedKeys.join("\0") ||
      typeof payload.text !== "string" ||
      typeof payload.documentNonce !== "string" ||
      typeof payload.documentUrl !== "string" ||
      typeof payload.principalId !== "string" ||
      typeof payload.environmentId !== "string"
    ) {
      return { kind: "invalid" };
    }
    const text = payload.text.trim();
    const documentUrl = payload.documentUrl;
    const principalId = payload.principalId;
    const environmentId = payload.environmentId;
    if (
      !text ||
      text.length > MAX_COMPOSER_CHARS ||
      !COMPOSER_GUARD_TOKEN_PATTERN.test(payload.documentNonce) ||
      !documentUrl ||
      documentUrl.length > 10000 ||
      !principalId ||
      principalId.length > 1000 ||
      environmentId.length > 1000 ||
      !Number.isInteger(payload.navigationGeneration) ||
      payload.navigationGeneration < 1 ||
      !Number.isInteger(payload.principalGeneration) ||
      payload.principalGeneration < 0 ||
      !Number.isInteger(payload.environmentGeneration) ||
      payload.environmentGeneration < 0
    ) {
      return { kind: "invalid" };
    }
    return {
      kind: "valid",
      text,
      documentNonce: payload.documentNonce,
      documentUrl,
      navigationGeneration: payload.navigationGeneration,
      principalId,
      principalGeneration: payload.principalGeneration,
      environmentId,
      environmentGeneration: payload.environmentGeneration,
    };
  } catch {
    return { kind: "invalid" };
  }
}

function selectionTranslationScript(options = {}) {
  const enabled = options.enabled === true;
  const marker = String(options.marker || "");
  const markerToken = marker.endsWith(":")
    ? marker.slice(SELECTION_TRANSLATION_CHANNEL_PREFIX.length, -1)
    : "";
  if (
    !marker.startsWith(SELECTION_TRANSLATION_CHANNEL_PREFIX) ||
    !COMPOSER_GUARD_TOKEN_PATTERN.test(markerToken) ||
    marker !== selectionTranslationMarker(markerToken)
  ) {
    throw new Error("Authenticated selection translation marker is required");
  }
  const documentNonce = assertComposerDocumentNonce(options.documentNonce);
  const documentUrl = String(options.documentUrl || "");
  const principalId = String(options.principalId || "");
  const environmentId = String(options.environmentId || "");
  const navigationGeneration = Number(options.navigationGeneration);
  const principalGeneration = Number(options.principalGeneration);
  const environmentGeneration = Number(options.environmentGeneration);
  if (
    !documentUrl ||
    documentUrl.length > 10000 ||
    !principalId ||
    principalId.length > 1000 ||
    environmentId.length > 1000 ||
    !Number.isInteger(navigationGeneration) ||
    navigationGeneration < 1 ||
    !Number.isInteger(principalGeneration) ||
    principalGeneration < 0 ||
    !Number.isInteger(environmentGeneration) ||
    environmentGeneration < 0
  ) {
    throw new Error("Selection translation context is invalid");
  }
  const debounceMs = Math.min(2000, Math.max(150, Number(options.debounceMs) || 450));
  const payload = serializeComposerScriptData({
    enabled,
    marker,
    documentNonce,
    documentUrl,
    navigationGeneration,
    principalId,
    principalGeneration,
    environmentId,
    environmentGeneration,
    debounceMs,
  });
  return `
    (() => {
      'use strict';
      const next = Object.freeze(${payload});
      const state = globalThis.__shareGptSelectionTranslation || {
        installed: false,
        enabled: false,
        timer: null,
        candidate: null,
        authorization: null,
        lastPublishedText: '',
      };
      globalThis.__shareGptSelectionTranslation = state;
      const clearTimer = () => {
        if (state.timer) globalThis.clearTimeout?.(state.timer);
        state.timer = null;
      };
      state.invalidate = () => {
        clearTimer();
        state.enabled = false;
        state.marker = '';
        state.candidate = null;
        state.authorization = null;
        state.lastPublishedText = '';
      };
      state.invalidate('reconfigured');
      Object.assign(state, next);

      const belongsToDocument = (node) => Boolean(
        node && (node === document || node.ownerDocument === document)
      );
      const composedParent = (node) => {
        if (!node) return null;
        if (node.assignedSlot) return node.assignedSlot;
        if (node.parentNode) return node.parentNode;
        return node.getRootNode?.()?.host || null;
      };
      const isEditableNode = (node) => {
        let current = node;
        const seen = new Set();
        for (let depth = 0; current && depth < 100 && !seen.has(current); depth += 1) {
          seen.add(current);
          if (current instanceof Element) {
            const contentEditable = String(current.getAttribute?.('contenteditable') || '').toLowerCase();
            if (
              current.matches?.('input, textarea, [role="textbox"]') ||
              current.isContentEditable ||
              contentEditable === 'true' ||
              contentEditable === 'plaintext-only'
            ) {
              return true;
            }
          }
          current = composedParent(current);
          if (current?.host && !current.parentNode) current = current.host;
        }
        return false;
      };
      const readCandidate = () => {
        if (!state.enabled) return null;
        const documentState = globalThis.__shareGptComposerDocument;
        if (
          !documentState ||
          documentState.nonce !== state.documentNonce ||
          documentState.url !== state.documentUrl ||
          String(globalThis.location?.href || '') !== state.documentUrl
        ) {
          return null;
        }
        const selection = globalThis.getSelection?.() || globalThis.window?.getSelection?.();
        if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
        let range;
        try {
          range = selection.getRangeAt(0);
        } catch {
          return null;
        }
        const anchor = selection.anchorNode;
        const focus = selection.focusNode;
        const common = range?.commonAncestorContainer;
        if (
          !belongsToDocument(anchor) ||
          !belongsToDocument(focus) ||
          !belongsToDocument(common) ||
          anchor.isConnected === false ||
          focus.isConnected === false ||
          common.isConnected === false ||
          isEditableNode(anchor) ||
          isEditableNode(focus) ||
          isEditableNode(common)
        ) {
          return null;
        }
        const text = String(selection.toString?.() || '').trim().slice(0, ${MAX_COMPOSER_CHARS});
        return text ? { text, anchor, focus, common } : null;
      };
      const updateCandidate = () => {
        state.candidate = readCandidate();
        if (!state.candidate) state.lastPublishedText = '';
        return state.candidate;
      };
      const sameCandidate = (left, right) => Boolean(
        left &&
        right &&
        left.text === right.text &&
        left.anchor === right.anchor &&
        left.focus === right.focus &&
        left.common === right.common
      );
      const publishAuthorized = () => {
        state.timer = null;
        const authorization = state.authorization;
        state.authorization = null;
        const current = updateCandidate();
        if (!authorization || !sameCandidate(authorization, current)) return false;
        if (current.text === state.lastPublishedText) return false;
        state.lastPublishedText = current.text;
        console.log(state.marker + JSON.stringify({
          text: current.text,
          documentNonce: state.documentNonce,
          documentUrl: state.documentUrl,
          navigationGeneration: state.navigationGeneration,
          principalId: state.principalId,
          principalGeneration: state.principalGeneration,
          environmentId: state.environmentId,
          environmentGeneration: state.environmentGeneration,
        }));
        return true;
      };
      const authorize = () => {
        clearTimer();
        const candidate = updateCandidate();
        state.authorization = candidate;
        if (!candidate) return false;
        state.timer = globalThis.setTimeout?.(publishAuthorized, state.debounceMs) || null;
        return true;
      };
      const trustedPointerSelection = (event) => Boolean(
        event?.isTrusted && event.button === 0 && event.isPrimary !== false
      );
      const trustedKeyboardSelection = (event) => {
        if (!event?.isTrusted || event.altKey) return false;
        const key = String(event.key || '');
        if (
          event.shiftKey &&
          ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(key)
        ) {
          return true;
        }
        return (
          key.toLowerCase() === 'a' &&
          !event.shiftKey &&
          Boolean(event.metaKey) !== Boolean(event.ctrlKey)
        );
      };
      if (!state.installed) {
        state.installed = true;
        document.addEventListener('selectionchange', updateCandidate, true);
        document.addEventListener('pointerup', (event) => {
          if (trustedPointerSelection(event)) authorize();
        }, true);
        document.addEventListener('keyup', (event) => {
          if (trustedKeyboardSelection(event)) authorize();
        }, true);
      }
      if (state.enabled) updateCandidate();
      return { ok: true, enabled: state.enabled };
    })();
  `;
}

async function installSelectionTranslation(webContents, options = {}) {
  if (!webContents || webContents.isDestroyed()) throw new Error("当前网页尚未打开");
  const worldId = Number.isInteger(options.worldId) ? options.worldId : COMPOSER_ISOLATED_WORLD_ID;
  return webContents.executeJavaScriptInIsolatedWorld(
    worldId,
    [{ code: selectionTranslationScript(options) }],
    false,
  );
}

function createSelectionTranslationRateLimiter(options = {}) {
  const minIntervalMs = Math.max(1, Number(options.minIntervalMs) || 350);
  const dedupeWindowMs = Math.max(minIntervalMs, Number(options.dedupeWindowMs) || 2000);
  const now = typeof options.now === "function" ? options.now : Date.now;
  let last = null;
  return {
    accept(text, documentNonce) {
      const value = String(text || "");
      const nonce = String(documentNonce || "");
      const timestamp = now();
      if (last && timestamp - last.acceptedAt < minIntervalMs) return false;
      if (
        last &&
        last.text === value &&
        last.documentNonce === nonce &&
        timestamp - last.acceptedAt < dedupeWindowMs
      ) {
        return false;
      }
      last = { text: value, documentNonce: nonce, acceptedAt: timestamp };
      return true;
    },
    clear() {
      last = null;
    },
  };
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
  const worldId = Number.isInteger(options.worldId) ? options.worldId : COMPOSER_ISOLATED_WORLD_ID;
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

async function installComposerDocumentNonce(webContents, options = {}) {
  if (!webContents || webContents.isDestroyed()) throw new Error("当前网页尚未打开");
  const worldId = Number.isInteger(options.worldId) ? options.worldId : COMPOSER_ISOLATED_WORLD_ID;
  const nonce = assertComposerDocumentNonce(options.nonce);
  const result = await webContents.executeJavaScriptInIsolatedWorld(
    worldId,
    [{ code: composerDocumentNonceScript(nonce) }],
    false,
  );
  if (!result?.ok || result.nonce !== nonce || !String(result.url || "")) {
    throw new Error("无法绑定网页文档身份");
  }
  return { nonce, url: String(result.url) };
}

async function invalidateComposerDocumentIdentity(webContents, options = {}) {
  if (!webContents || webContents.isDestroyed()) return false;
  const result = await webContents.executeJavaScriptInIsolatedWorld(
    COMPOSER_ISOLATED_WORLD_ID,
    [{ code: composerDocumentInvalidateScript(options) }],
    false,
  );
  return result === true;
}

async function armComposerEnterGate(webContents, options = {}) {
  if (!webContents || webContents.isDestroyed()) throw new Error("当前网页尚未打开");
  const result = await webContents.executeJavaScriptInIsolatedWorld(
    COMPOSER_ISOLATED_WORLD_ID,
    [{ code: composerEnterGateArmScript(options) }],
    false,
  );
  if (!result?.ok || result.status !== "pending" || result.token !== options.token) {
    throw Object.assign(new Error("网页发送焦点已经变化，请重新操作"), {
      code: "COMPOSER_ENTER_GATE_BLOCKED",
      reason: String(result?.reason || "gate-unavailable"),
    });
  }
  return result;
}

async function readComposerEnterGateOutcome(webContents, token) {
  if (!webContents || webContents.isDestroyed()) {
    return { token: String(token || ""), status: "unknown", reason: "destroyed" };
  }
  return webContents.executeJavaScriptInIsolatedWorld(
    COMPOSER_ISOLATED_WORLD_ID,
    [{ code: composerEnterGateOutcomeScript(token) }],
    false,
  );
}

async function waitForComposerEnterGateOutcome(webContents, token, options = {}) {
  const attempts = Math.max(1, Math.min(50, Number(options.attempts) || 20));
  const intervalMs = Math.max(1, Math.min(50, Number(options.intervalMs) || 10));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const outcome = await readComposerEnterGateOutcome(webContents, token);
    if (outcome?.status !== "pending") return outcome;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { token, status: "pending", reason: "outcome-timeout" };
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
  const documentNonce = assertComposerDocumentNonce(options.documentNonce);
  const documentUrl = String(options.documentUrl || "");
  const assertCurrent =
    typeof options.assertCurrent === "function" ? options.assertCurrent : () => undefined;
  assertCurrent();
  if (!webContents || webContents.isDestroyed()) throw new Error("当前网页尚未打开");
  webContents.focus();
  assertCurrent();
  const result = await webContents.executeJavaScriptInIsolatedWorld(
    COMPOSER_ISOLATED_WORLD_ID,
    [
      {
        code: composerMutationScript({
          documentNonce,
          documentUrl,
          text: value,
          enterGateToken: options.enterGateToken,
          enterGateTtlMs: options.enterGateTtlMs,
        }),
      },
    ],
    false,
  );
  assertCurrent();
  if (result?.ok) {
    const response = {
      ok: true,
      replacedTextLength: Number(result.replacedTextLength),
    };
    const enterGateToken = String(result.enterGateToken || "");
    return enterGateToken ? { ...response, enterGateToken } : response;
  }
  if (result?.reason === "stale-document") {
    throw Object.assign(new Error("网页文档已经变化，请重新操作"), {
      code: "COMPOSER_DOCUMENT_STALE",
    });
  }
  if (result?.reason === "no-editor") throw new Error("请先在网页中点一下提问输入框");
  if (result?.reason === "stale-editor") {
    throw Object.assign(new Error("网页输入框已经变化，请重新操作"), {
      code: "COMPOSER_EDITOR_STALE",
    });
  }
  if (result?.reason === "beforeinput-cancelled") {
    throw new Error("网页拒绝了输入操作，请重新点击输入框");
  }
  if (result?.reason === "enter-gate-unavailable") {
    throw Object.assign(new Error("网页发送保护尚未准备好，请重新操作"), {
      code: "COMPOSER_ENTER_GATE_BLOCKED",
    });
  }
  throw new Error("无法写入网页输入框");
}

function sendComposerEnter(webContents) {
  if (!webContents || webContents.isDestroyed()) throw new Error("当前网页尚未打开");
  webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
  webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
}

function assertExpectedComposerContextGeneration(workspace, expectedGeneration) {
  const expected = Number(expectedGeneration);
  const current = Number(workspace?.composerContextGeneration || 0);
  if (!Number.isInteger(expected) || expected < 1 || current !== expected) {
    throw Object.assign(new Error("网页导航上下文已失效"), {
      code: "COMPOSER_CONTEXT_STALE",
    });
  }
  return current;
}

module.exports = {
  COMPOSER_ENTER_GATE_TTL_MS,
  COMPOSER_GUARD_CHANNEL_PREFIX,
  COMPOSER_ISOLATED_WORLD_ID,
  MAX_COMPOSER_CHARS,
  SELECTION_TRANSLATION_CHANNEL_PREFIX,
  armComposerEnterGate,
  assertExpectedComposerContextGeneration,
  composerGuardMarker,
  composerClickGuardScript,
  composerDocumentInvalidateScript,
  composerDocumentNonceScript,
  composerEnterGateArmScript,
  composerEnterGateOutcomeScript,
  composerInspectionScript,
  composerMutationScript,
  createComposerConfirmationRegistry,
  createComposerDocumentNonce,
  createComposerEnterGateToken,
  createComposerGuardToken,
  createOneShotComposerBypass,
  createSelectionTranslationRateLimiter,
  disableComposerClickGuard,
  hasClearlyNonTargetLanguage,
  installComposerClickGuard,
  installComposerDocumentNonce,
  installSelectionTranslation,
  invalidateComposerDocumentIdentity,
  inspectAiComposer,
  inspectComposerSubmit,
  isPlainComposerSubmit,
  parseComposerGuardConsoleMessage,
  parseSelectionTranslationConsoleMessage,
  readComposerEnterGateOutcome,
  replaceAiComposerText,
  selectionTranslationMarker,
  selectionTranslationScript,
  sendComposerEnter,
  waitForComposerEnterGateOutcome,
};
