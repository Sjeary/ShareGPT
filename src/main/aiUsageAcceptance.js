const crypto = require("node:crypto");
const {
  COMPOSER_GUARD_BLOCKED_EVENT,
  isLikelyComposerEditorInPage,
} = require("./aiComposerOperation");

const SEND_ATTEMPT_MARKER_PREFIX = "__SHAREGPT_SEND_ATTEMPT_V1__:";
const ACCEPTED_SEND_WORLD_ID = 1002;
const TRACKER_TOKEN_PATTERN = /^[a-zA-Z0-9_-]{32,128}$/;

function createTrackerToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function sendAttemptMarker(token) {
  const value = String(token || "");
  if (!TRACKER_TOKEN_PATTERN.test(value)) throw new Error("Usage tracker token is invalid");
  return `${SEND_ATTEMPT_MARKER_PREFIX}${value}:`;
}

function sendAttemptTrackerScript(token) {
  const marker = sendAttemptMarker(token);
  const composerEditorSource = isLikelyComposerEditorInPage.toString();
  return `
    (() => {
      'use strict';
      const marker = ${JSON.stringify(marker)};
      const blockedEventName = ${JSON.stringify(COMPOSER_GUARD_BLOCKED_EVENT)};
      const key = ${JSON.stringify(`__shareGptAcceptedSendTracker_${token}`)};
      const isLikelyComposerEditor = ${composerEditorSource};
      if (globalThis[key]?.installed) return true;
      const state = {
        installed: true,
        pendingEditors: new WeakMap(),
      };
      globalThis[key] = state;
      const selector = 'textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
      const read = (editor) => String('value' in editor ? editor.value : editor.innerText || editor.textContent || '').trim();
      const visible = (editor) => {
        const rect = editor?.getBoundingClientRect?.();
        return Boolean(editor?.isConnected && rect && rect.width > 1 && rect.height > 1);
      };
      const findEditor = (target) => {
        const direct = target?.matches?.(selector) ? target : target?.closest?.(selector);
        if (visible(direct) && isLikelyComposerEditor(direct)) return direct;
        return Array.from(document.querySelectorAll(selector)).find((node) => visible(node) && read(node) && isLikelyComposerEditor(node));
      };
      const cancelReservation = (editor) => state.pendingEditors.delete(editor);
      const recordAttempt = (editor, event) => {
        if (state.pendingEditors.has(editor)) return;
        const eventTime = Number(event?.timeStamp);
        const attemptedAt = Number.isFinite(eventTime) && globalThis.performance?.timeOrigin
          ? Math.round(globalThis.performance.timeOrigin + eventTime)
          : Date.now();
        const reservation = { attemptedAt };
        state.pendingEditors.set(editor, reservation);
        globalThis.setTimeout(() => {
          if (state.pendingEditors.get(editor) !== reservation) return;
          state.pendingEditors.delete(editor);
          if (!visible(editor)) {
            return;
          }
          const id = globalThis.crypto?.randomUUID?.();
          if (id) console.log(marker + JSON.stringify({ id, attemptedAt: reservation.attemptedAt }));
        }, 0);
      };
      document.addEventListener(blockedEventName, (event) => {
        const editor = findEditor(event.target);
        if (editor) cancelReservation(editor);
      }, true);
      document.addEventListener('keydown', (event) => {
        if (
          event.key !== 'Enter' || event.altKey || event.ctrlKey || event.metaKey ||
          event.shiftKey || event.repeat || event.isComposing
        ) return;
        const editor = findEditor(event.target);
        const text = editor ? read(editor) : '';
        if (text) recordAttempt(editor, event);
      }, true);
      document.addEventListener('click', (event) => {
        const button = event.target?.closest?.('button[data-testid="send-button"], button[aria-label*="Send" i], button[aria-label*="发送"]');
        if (!button) return;
        const editor = findEditor(document.activeElement);
        const text = editor ? read(editor) : '';
        if (text) recordAttempt(editor, event);
      }, true);
      return true;
    })();
  `;
}

async function installAcceptedSendTracker(webContents, token, options = {}) {
  if (!webContents || webContents.isDestroyed?.()) {
    throw new Error("当前网页尚未打开");
  }
  return webContents.executeJavaScriptInIsolatedWorld(
    Number(options.worldId || ACCEPTED_SEND_WORLD_ID),
    [{ code: sendAttemptTrackerScript(token) }],
    false,
  );
}

function parseSendAttemptMessage(message, token) {
  const marker = sendAttemptMarker(token);
  const value = String(message || "");
  if (!value.startsWith(marker)) return null;
  try {
    const payload = JSON.parse(value.slice(marker.length));
    const keys = Object.keys(payload || {}).sort();
    if (keys.join(",") !== "attemptedAt,id") return null;
    const id = String(payload.id || "");
    const attemptedAt = Number(payload.attemptedAt);
    if (!/^[a-z0-9-]{3,80}$/i.test(id) || !Number.isFinite(attemptedAt) || attemptedAt < 1)
      return null;
    return { id, attemptedAt };
  } catch {
    return null;
  }
}

function isAcceptedAiConversationResponse(kind, details) {
  return (
    isAiConversationRequest(kind, details) &&
    Number(details?.statusCode) >= 200 &&
    Number(details?.statusCode) < 300
  );
}

function isAiConversationRequest(kind, details) {
  if (String(details?.method || "").toUpperCase() !== "POST") return false;
  let url;
  try {
    url = new URL(String(details?.url || ""));
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname;
  if (kind === "gpt") {
    return host === "chatgpt.com" && /^\/backend-api\/(?:f\/)?conversation(?:\/|$)/.test(pathname);
  }
  if (kind === "claude") {
    return (
      host === "claude.ai" &&
      /^\/api\/(?:organizations\/[^/]+\/)?chat_conversations\/[^/]+\/completion\/?$/.test(pathname)
    );
  }
  if (kind === "gemini") {
    return host === "gemini.google.com" && pathname.includes("BardFrontendService/StreamGenerate");
  }
  return false;
}

function createUsageAttemptTracker(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const ttlMs = Math.max(1000, Number(options.ttlMs) || 15000);
  const requestStartWindowMs = Math.max(
    100,
    Math.min(ttlMs, Number(options.requestStartWindowMs) || 3000),
  );
  const requestCompletionTtlMs = Math.max(
    ttlMs,
    Number(options.requestCompletionTtlMs) || 30 * 60 * 1000,
  );
  const startClockSkewMs = Math.max(0, Math.min(100, Number(options.startClockSkewMs) || 10));
  const attempts = new Map();
  const requests = new Map();
  // A gesture and a network request may reach the main process in either order. Bind once by
  // webContents + start time, then settle only through that Electron request id.
  const requestKey = (details) => {
    const value = details?.id ?? details?.requestId;
    return value === undefined || value === null || String(value) === "" ? "" : String(value);
  };
  const cleanup = () => {
    const current = now();
    for (const [id, entry] of attempts) {
      if (entry.expiresAt <= current) attempts.delete(id);
    }
    for (const [id, entry] of requests) {
      if (entry.expiresAt <= current) requests.delete(id);
    }
  };
  const canBind = (attempt, request) =>
    !attempt.requestId &&
    !request.attemptId &&
    attempt.webContentsId === request.webContentsId &&
    request.startedAt + startClockSkewMs >= attempt.attemptedAt &&
    request.startedAt <=
      (attempt.requestCount > 0 ? attempt.retryUntil : attempt.attemptedAt + requestStartWindowMs);
  const consume = (attempt, request) => {
    attempts.delete(attempt.id);
    requests.delete(request.id);
    if (!request.completed || !request.accepted) return null;
    return { id: attempt.id, acceptedAt: request.completedAt };
  };
  const bind = (attempt, request) => {
    attempt.requestId = request.id;
    attempt.requestCount += 1;
    attempt.expiresAt = now() + requestCompletionTtlMs;
    request.attemptId = attempt.id;
    request.expiresAt = attempt.expiresAt;
    return request.completed ? consume(attempt, request) : null;
  };
  const findRequestForAttempt = (attempt) => {
    let candidate = null;
    for (const request of requests.values()) {
      if (!canBind(attempt, request)) continue;
      if (!candidate || request.startedAt < candidate.startedAt) candidate = request;
    }
    return candidate;
  };
  const findAttemptForRequest = (request) => {
    let candidate = null;
    for (const attempt of attempts.values()) {
      if (!canBind(attempt, request)) continue;
      if (!candidate || attempt.attemptedAt < candidate.attemptedAt) candidate = attempt;
    }
    return candidate;
  };
  const discardRequest = (details) => {
    cleanup();
    const id = requestKey(details);
    const request = requests.get(id);
    if (!request || request.webContentsId !== Number(details?.webContentsId)) return null;
    requests.delete(id);
    if (!request.attemptId) return null;
    const attempt = attempts.get(request.attemptId);
    if (!attempt) return null;
    attempt.requestId = "";
    if (now() > attempt.retryUntil) {
      attempts.delete(attempt.id);
      return null;
    }
    attempt.expiresAt = attempt.retryUntil;
    const retry = findRequestForAttempt(attempt);
    return retry ? bind(attempt, retry) : null;
  };
  return {
    record(attempt, webContentsId) {
      cleanup();
      const id = String(attempt?.id || "");
      const contentsId = Number(webContentsId);
      const attemptedAt = Number(attempt?.attemptedAt);
      if (
        !/^[a-z0-9-]{3,80}$/i.test(id) ||
        !Number.isInteger(contentsId) ||
        !Number.isFinite(attemptedAt)
      )
        return null;
      const entry = {
        id,
        webContentsId: contentsId,
        attemptedAt,
        expiresAt: now() + ttlMs,
        retryUntil: attemptedAt + ttlMs,
        requestId: "",
        requestCount: 0,
      };
      attempts.set(id, entry);
      const request = findRequestForAttempt(entry);
      return request ? bind(entry, request) : null;
    },
    recordRequestStart(kind, details) {
      cleanup();
      if (!isAiConversationRequest(kind, details)) return null;
      const id = requestKey(details);
      const contentsId = Number(details?.webContentsId);
      if (!id || !Number.isInteger(contentsId) || requests.has(id)) return null;
      const startedAt = now();
      const entry = {
        id,
        webContentsId: contentsId,
        startedAt,
        expiresAt: startedAt + ttlMs,
        attemptId: "",
        completed: false,
        accepted: false,
        completedAt: 0,
      };
      requests.set(id, entry);
      const attempt = findAttemptForRequest(entry);
      return attempt ? bind(attempt, entry) : null;
    },
    acceptResponse(kind, details) {
      cleanup();
      const id = requestKey(details);
      const contentsId = Number(details?.webContentsId);
      const request = requests.get(id);
      if (!request || request.webContentsId !== contentsId) return null;
      request.completed = true;
      request.accepted = isAcceptedAiConversationResponse(kind, details);
      request.completedAt = now();
      if (!request.accepted) return discardRequest(details);
      if (request.attemptId) {
        const attempt = request.attemptId ? attempts.get(request.attemptId) : null;
        if (attempt) return consume(attempt, request);
        requests.delete(id);
      }
      return null;
    },
    failRequest(details) {
      return discardRequest(details);
    },
    expire() {
      cleanup();
    },
    clear() {
      attempts.clear();
      requests.clear();
    },
    size() {
      cleanup();
      return { attempts: attempts.size, requests: requests.size };
    },
  };
}

function createAcceptedSendDedupe(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const ttlMs = Math.max(1000, Number(options.ttlMs) || 60000);
  const seen = new Map();
  return {
    accept(id) {
      const key = String(id || "");
      const current = now();
      for (const [entry, expiresAt] of seen) {
        if (expiresAt <= current) seen.delete(entry);
      }
      if (!key || seen.has(key)) return false;
      seen.set(key, current + ttlMs);
      return true;
    },
    clear() {
      seen.clear();
    },
  };
}

module.exports = {
  SEND_ATTEMPT_MARKER_PREFIX,
  ACCEPTED_SEND_WORLD_ID,
  COMPOSER_GUARD_BLOCKED_EVENT,
  createAcceptedSendDedupe,
  createTrackerToken,
  createUsageAttemptTracker,
  isAiConversationRequest,
  isAcceptedAiConversationResponse,
  installAcceptedSendTracker,
  parseSendAttemptMessage,
  sendAttemptMarker,
  sendAttemptTrackerScript,
};
