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
          // The page may replace its composer while submitting. Acceptance is
          // determined by the matching network response, not the old DOM node.
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
          event.key !== 'Enter' || event.altKey || event.shiftKey || event.repeat || event.isComposing
        ) return;
        const editor = findEditor(event.target);
        const text = editor ? read(editor) : '';
        if (text) recordAttempt(editor, event);
      }, true);
      document.addEventListener('click', (event) => {
        const button = event.target?.closest?.('button[data-testid="send-button"], button[data-testid*="send" i], button#composer-submit-button, button[aria-label*="send" i], button[aria-label*="发送"]');
        if (!button || button.disabled) return;
        const editor = findEditor(document.activeElement);
        if (editor) {
          recordAttempt(editor, event);
        } else {
          recordAttempt(button, event);
        }
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
    return (
      (host === "chatgpt.com" || host === "chat.openai.com") &&
      /^\/backend-api\/(?:f\/)?conversation\/?$/.test(pathname)
    );
  }
  if (kind === "claude") {
    return (
      host === "claude.ai" &&
      /^\/api\/(?:organizations\/[^/]+\/)?chat_conversations\/[^/]+\/(?:retry_)?completion\/?$/.test(
        pathname,
      )
    );
  }
  if (kind === "gemini") {
    return host === "gemini.google.com" && pathname.includes("BardFrontendService/StreamGenerate");
  }
  return false;
}

function createUsageAttemptTracker(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const ttlMs = Math.max(1000, Number(options.ttlMs) || 30000);
  const requestStartWindowMs = Math.max(
    100,
    Math.min(ttlMs, Number(options.requestStartWindowMs) || 15000),
  );
  const requestCompletionTtlMs = Math.max(
    ttlMs,
    Number(options.requestCompletionTtlMs) || 30 * 60 * 1000,
  );
  const startClockSkewMs = Math.max(0, Math.min(250, Number(options.startClockSkewMs) || 50));
  const onUnmatchedAccepted =
    typeof options.onUnmatchedAccepted === "function" ? options.onUnmatchedAccepted : null;
  const networkFallbackGraceMs = Math.max(
    50,
    Math.min(5000, Number(options.networkFallbackGraceMs) || 400),
  );
  const attempts = new Map();
  const requests = new Map();
  const fallbackTimers = new Map();
  // Keep settled network identities after emitting usage: a 2xx stream can
  // subsequently fail and be retried without another user gesture.
  const settledRequests = new Map();
  const retryWindowMs = Math.max(100, Number(options.retryWindowMs) || 5000);
  const rememberSettlement = (request, event) => {
    settledRequests.set(request.id, {
      ...request,
      event,
      expiresAt:
        now() + (request.failedAt || request.transportCompleted ? ttlMs : requestCompletionTtlMs),
    });
  };
  const retrySettlement = (request) => {
    for (const settled of settledRequests.values()) {
      if (
        settled.failedAt &&
        settled.webContentsId === request.webContentsId &&
        settled.url === request.url &&
        request.startedAt >= settled.startedAt &&
        request.startedAt <= settled.failedAt + retryWindowMs
      )
        return settled;
    }
    return null;
  };
  const clearFallbackTimer = (id) => {
    const timer = fallbackTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      fallbackTimers.delete(id);
    }
  };
  // A gesture and a network request may reach the main process in either order. Bind once by
  // webContents + start time, then settle only through that Electron request id.
  const requestKey = (details) => {
    const value = details?.id ?? details?.requestId;
    return value === undefined || value === null || String(value) === "" ? "" : String(value);
  };
  const cleanup = () => {
    const current = now();
    for (const [id, entry] of settledRequests) {
      if (entry.expiresAt <= current) settledRequests.delete(id);
    }
    for (const [id, entry] of attempts) {
      if (entry.expiresAt <= current) attempts.delete(id);
    }
    for (const [id, entry] of requests) {
      if (entry.expiresAt <= current) {
        clearFallbackTimer(id);
        requests.delete(id);
      }
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
    clearFallbackTimer(request.id);
    attempts.delete(attempt.id);
    requests.delete(request.id);
    if (!request.completed || !request.accepted) return null;
    const event = { id: attempt.id, acceptedAt: request.completedAt };
    rememberSettlement(request, event);
    return event;
  };
  const bind = (attempt, request) => {
    clearFallbackTimer(request.id);
    attempt.requestId = request.id;
    attempt.requestCount += 1;
    attempt.expiresAt = now() + requestCompletionTtlMs;
    request.attemptId = attempt.id;
    request.expiresAt = attempt.expiresAt;
    return request.completed ? consume(attempt, request) : null;
  };
  const scheduleUnmatchedFallback = (kind, request) => {
    if (!onUnmatchedAccepted || fallbackTimers.has(request.id)) return;
    const timer = setTimeout(() => {
      fallbackTimers.delete(request.id);
      cleanup();
      const current = requests.get(request.id);
      if (!current || !current.completed || !current.accepted || current.attemptId) return;
      // A bound attempt can still own an overlapping retry, but only during
      // its finite binding window. Recheck instead of silently dropping work.
      for (const attempt of attempts.values()) {
        const bindUntil =
          attempt.requestCount > 0
            ? attempt.retryUntil
            : attempt.attemptedAt + requestStartWindowMs;
        if (
          attempt.webContentsId === current.webContentsId &&
          current.startedAt + startClockSkewMs >= attempt.attemptedAt &&
          current.startedAt <= bindUntil &&
          now() <= bindUntil
        ) {
          scheduleUnmatchedFallback(kind, current);
          return;
        }
      }
      requests.delete(current.id);
      const previousEvent = current.retryEvent || retrySettlement(current)?.event;
      if (previousEvent) {
        rememberSettlement(current, previousEvent);
        return;
      }
      const event = { id: `net-${crypto.randomUUID()}`, acceptedAt: current.completedAt };
      rememberSettlement(current, event);
      onUnmatchedAccepted(kind, current.webContentsId, event);
    }, networkFallbackGraceMs);
    if (typeof timer.unref === "function") timer.unref();
    fallbackTimers.set(request.id, timer);
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
    if (request.completed && request.accepted) return null;
    clearFallbackTimer(id);
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
      if (!id || !Number.isInteger(contentsId) || requests.has(id) || settledRequests.has(id))
        return null;
      const startedAt = now();
      const entry = {
        id,
        webContentsId: contentsId,
        startedAt,
        url: String(details.url),
        failedAt: 0,
        expiresAt: startedAt + ttlMs,
        attemptId: "",
        completed: false,
        accepted: false,
        completedAt: 0,
        transportCompleted: false,
        retryEvent: null,
      };
      entry.retryEvent = retrySettlement(entry)?.event || null;
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
      if (request.completed && request.accepted) return null;
      request.completed = true;
      request.accepted = isAcceptedAiConversationResponse(kind, details);
      request.completedAt = now();
      if (!request.accepted) return discardRequest(details);
      if (onUnmatchedAccepted) request.expiresAt = now() + requestCompletionTtlMs;
      if (request.attemptId) {
        const attempt = attempts.get(request.attemptId);
        if (attempt) return consume(attempt, request);
        request.attemptId = "";
      }
      scheduleUnmatchedFallback(kind, request);
      return null;
    },
    completeRequest(kind, details) {
      const event = this.acceptResponse(kind, details);
      const id = requestKey(details);
      const request = requests.get(id) || settledRequests.get(id);
      if (request && request.webContentsId === Number(details?.webContentsId)) {
        request.transportCompleted = true;
        if (settledRequests.has(id)) request.expiresAt = now() + ttlMs;
      }
      return event;
    },
    failRequest(details) {
      cleanup();
      const id = requestKey(details);
      const request = requests.get(id) || settledRequests.get(id);
      if (request && request.webContentsId === Number(details?.webContentsId)) {
        request.failedAt = now();
        if (settledRequests.has(id)) request.expiresAt = now() + ttlMs;
        if (request.completed && request.accepted) return null;
      }
      return discardRequest(details);
    },
    expire() {
      cleanup();
    },
    clear() {
      for (const timer of fallbackTimers.values()) clearTimeout(timer);
      fallbackTimers.clear();
      attempts.clear();
      requests.clear();
      settledRequests.clear();
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
