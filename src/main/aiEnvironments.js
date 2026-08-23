const AI_KINDS = new Set(["gpt", "gemini", "claude"]);
const AI_PROXY_MODES = new Set(["sender", "system", "direct", "socks5"]);

function safeText(value, maxLength = 120) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

function normalizeAiEnvironmentId(value) {
  const id = safeText(value, 48).toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,47}$/.test(id) ? id : "";
}

function partitionForAiEnvironment(kind, environmentId) {
  const targetKind = safeText(kind, 16).toLowerCase();
  const targetEnvironmentId = normalizeAiEnvironmentId(environmentId);
  if (!AI_KINDS.has(targetKind) || !targetEnvironmentId) {
    throw new Error("AI 环境标识不合法");
  }
  return `persist:sharegpt-ai-${targetKind}-${targetEnvironmentId}`;
}

function normalizeLoopbackHost(value) {
  const host = safeText(value || "127.0.0.1", 80).toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
    return host === "[::1]" ? "::1" : host;
  }
  return "";
}

function normalizeAiProxyRoute(raw, sender = {}) {
  const mode = AI_PROXY_MODES.has(safeText(raw?.mode, 16)) ? safeText(raw.mode, 16) : "sender";
  const label = safeText(raw?.label, 60);
  if (mode === "direct" || mode === "system") {
    return { mode, label: label || (mode === "direct" ? "直连" : "系统代理") };
  }

  const fallbackPort = mode === "sender" ? sender.port : raw?.port;
  const port = Number.parseInt(String(fallbackPort || ""), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(mode === "sender" ? "请先配置有效的统一代理端口" : "SOCKS5 端口不合法");
  }

  const host = normalizeLoopbackHost(mode === "sender" ? sender.host : raw?.host);
  if (!host) {
    throw new Error("高级线路当前只允许本机 SOCKS5 端点");
  }

  return {
    mode,
    label: label || (mode === "sender" ? "当前统一代理" : `SOCKS5 :${port}`),
    host,
    port,
  };
}

module.exports = {
  normalizeAiEnvironmentId,
  normalizeAiProxyRoute,
  partitionForAiEnvironment,
};
