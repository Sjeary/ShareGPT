const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10000;

function createAuthorizationEpochGuard() {
  let current = 0;
  return {
    advance() {
      current += 1;
      return current;
    },
    assert(epoch) {
      if (epoch !== current) {
        throw Object.assign(new Error("协作会话授权请求已失效"), {
          code: "AI_AUTHORIZATION_STALE",
        });
      }
    },
    isCurrent(epoch) {
      return epoch === current;
    },
  };
}

function exactUsername(value) {
  return typeof value === "string" ? value : "";
}

function resolveAiSessionCapability(bootstrap, profilePayload, expectedUsername) {
  const username = exactUsername(expectedUsername);
  if (!username) throw new Error("协作会话账号无效");

  const authorization = bootstrap?.authorization;
  if (authorization !== undefined && authorization !== null) {
    if (exactUsername(authorization.username) !== username) {
      throw new Error("协作服务器未返回匹配的账号授权");
    }
    return {
      legacy: false,
      username,
      isAdmin: authorization.isAdmin === true,
      advancedAiAllowed: authorization.advancedAiAllowed === true,
      allowedProxyRouteIds: Array.isArray(authorization.allowedProxyRouteIds)
        ? authorization.allowedProxyRouteIds
        : [],
    };
  }

  if (exactUsername(profilePayload?.profile?.username) !== username) {
    throw new Error("旧版协作服务器未返回匹配的账号信息");
  }
  return {
    legacy: true,
    username,
    isAdmin: false,
    advancedAiAllowed: false,
    allowedProxyRouteIds: [],
  };
}

async function readBoundedResponseText(response, maxBytes = DEFAULT_MAX_RESPONSE_BYTES) {
  const limit = Math.max(1, Number(maxBytes) || DEFAULT_MAX_RESPONSE_BYTES);
  const reader = response?.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > limit) throw new Error("协作服务器授权响应过大");
    return text;
  }

  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
    total += chunk.byteLength;
    if (total > limit) {
      await reader.cancel?.("response-too-large");
      throw new Error("协作服务器授权响应过大");
    }
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchAuthenticatedJson(fetchImpl, url, token, options = {}) {
  if (typeof fetchImpl !== "function") throw new Error("协作服务器请求不可用");
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: controller.signal,
    });
    const body = await readBoundedResponseText(response, options.maxBytes);
    if (!response.ok) throw new Error(body || `协作会话授权失败（${response.status}）`);
    try {
      return JSON.parse(body);
    } catch {
      throw new Error("协作服务器授权响应无效");
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("协作服务器授权请求超时", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  createAuthorizationEpochGuard,
  fetchAuthenticatedJson,
  readBoundedResponseText,
  resolveAiSessionCapability,
};
