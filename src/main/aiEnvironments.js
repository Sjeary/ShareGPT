const AI_KINDS = new Set(["gpt", "gemini", "claude"]);
const INTERNAL_AI_ROUTE_IDS = new Set(["internal-unified", "internal-airport"]);

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

function normalizeAiRouteId(value) {
  const id = safeText(value, 48).toLowerCase();
  return INTERNAL_AI_ROUTE_IDS.has(id) ? id : "internal-unified";
}

function shouldCloseAiWorkspacesForEnvironment(workspaces, environmentId) {
  const targetEnvironmentId = normalizeAiEnvironmentId(environmentId);
  return (Array.isArray(workspaces) ? workspaces : []).some(
    (workspace) => normalizeAiEnvironmentId(workspace?.environmentId) !== targetEnvironmentId,
  );
}

function scaleAiHostBounds(bounds, zoomFactor) {
  const scale = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  const source = bounds && typeof bounds === "object" ? bounds : {};
  const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  return {
    x: Math.round(number(source.x) * scale),
    y: Math.round(number(source.y) * scale),
    width: Math.max(1, Math.round(number(source.width) * scale)),
    height: Math.max(1, Math.round(number(source.height) * scale)),
  };
}

function hasCompleteUnifiedProxy(sender = {}) {
  const port = Number.parseInt(String(sender.proxy_port || ""), 10);
  return Boolean(
    safeText(sender.proxy_server, 240) &&
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535 &&
    safeText(sender.proxy_uuid, 160),
  );
}

function internalAiProxyRoutes(sender = {}) {
  const listenPort = Number.parseInt(String(sender.socks_listen_port || ""), 10);
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
    throw new Error("本地 SOCKS 监听端口不合法");
  }
  const useForwardOffsets = listenPort <= 65533;
  const unifiedPort = useForwardOffsets ? listenPort + 1 : listenPort - 1;
  const airportPort = useForwardOffsets ? listenPort + 2 : listenPort - 2;
  const routes = [];

  if (hasCompleteUnifiedProxy(sender)) {
    routes.push({
      id: "internal-unified",
      label: "内置统一代理",
      mode: "singbox",
      host: "127.0.0.1",
      port: unifiedPort,
      inboundTag: "ai-unified-in",
      outboundTag: "proxy-unified",
    });
  }
  if (sender.airport_outbound && typeof sender.airport_outbound === "object") {
    const airportName = safeText(sender.airport_name, 80);
    routes.push({
      id: "internal-airport",
      label: airportName ? `内置节点 · ${airportName}` : "内置机场节点",
      mode: "singbox",
      host: "127.0.0.1",
      port: airportPort,
      inboundTag: "ai-airport-in",
      outboundTag: "proxy-airport",
    });
  }
  return routes;
}

module.exports = {
  hasCompleteUnifiedProxy,
  internalAiProxyRoutes,
  normalizeAiEnvironmentId,
  normalizeAiRouteId,
  partitionForAiEnvironment,
  scaleAiHostBounds,
  shouldCloseAiWorkspacesForEnvironment,
};
