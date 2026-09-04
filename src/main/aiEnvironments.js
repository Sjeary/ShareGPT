const AI_KINDS = new Set(["gpt", "gemini", "claude"]);
const { normalizePrincipalId } = require("./principal");

function safeText(value, maxLength = 120) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

function normalizeAiEnvironmentId(value) {
  const id = safeText(value, 48).toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,47}$/.test(id) ? id : "";
}

function partitionForAiEnvironment(kind, environmentId, principalContext = {}) {
  const targetKind = safeText(kind, 16).toLowerCase();
  const targetEnvironmentId = normalizeAiEnvironmentId(environmentId);
  const principalId = normalizePrincipalId(principalContext.principalId, { allowLocal: true });
  const legacyOwnerId = normalizePrincipalId(principalContext.legacyPartitionOwnerId, {
    allowLocal: true,
  });
  if (!AI_KINDS.has(targetKind) || !targetEnvironmentId || !principalId) {
    throw new Error("AI 环境标识不合法");
  }
  if (legacyOwnerId && principalId === legacyOwnerId) {
    return `persist:sharegpt-ai-${targetKind}-${targetEnvironmentId}`;
  }
  return `persist:sharegpt-ai-${principalId}-${targetKind}-${targetEnvironmentId}`;
}

function normalizeAiRouteId(value) {
  const id = safeText(value, 64).toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) ? id : "";
}

function managedDefaultRouteId(sender, kind) {
  const targetKind = safeText(kind, 16).toLowerCase();
  if (!AI_KINDS.has(targetKind) || sender?.proxy_mode === "personal") return "";
  return normalizeAiRouteId(sender?.managed_default_route_by_kind?.[targetKind]);
}

function activeAiRouteIds(sender, advancedAi) {
  if (sender?.proxy_mode === "personal") return [];
  const routeIds = new Set();
  for (const kind of AI_KINDS) {
    const defaultRouteId = managedDefaultRouteId(sender, kind);
    if (defaultRouteId) routeIds.add(defaultRouteId);

    if (advancedAi?.enabled !== true) continue;
    const environmentId = normalizeAiEnvironmentId(advancedAi?.activeByKind?.[kind]);
    if (!environmentId) continue;
    const environment = Array.isArray(advancedAi?.environments)
      ? advancedAi.environments.find(
          (record) =>
            safeText(record?.kind, 16).toLowerCase() === kind &&
            normalizeAiEnvironmentId(record?.id) === environmentId,
        )
      : null;
    const environmentRouteId = normalizeAiRouteId(environment?.routeId);
    if (environmentRouteId) routeIds.add(environmentRouteId);
  }
  return [...routeIds];
}

function resolvedProxyMatchesRoute(value, route) {
  const expectedHost = safeText(route?.host, 255)
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  const expectedPort = Number.parseInt(String(route?.port || ""), 10);
  if (
    !expectedHost ||
    !Number.isInteger(expectedPort) ||
    expectedPort < 1 ||
    expectedPort > 65535
  ) {
    return false;
  }

  return String(value || "")
    .split(";")
    .some((entry) => {
      const match = entry.trim().match(/^SOCKS(?:4|5)?\s+(\[[^\]]+\]|[^\s:]+):(\d+)$/i);
      if (!match) return false;
      const host = match[1].replace(/^\[|\]$/g, "").toLowerCase();
      return host === expectedHost && Number.parseInt(match[2], 10) === expectedPort;
    });
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
  const definitions = [];
  const authorized = Array.isArray(sender.authorized_proxy_route_ids)
    ? new Set(sender.authorized_proxy_route_ids.map(normalizeAiRouteId).filter(Boolean))
    : null;
  const isAuthorized = (id) => !authorized || authorized.has(id);

  if (hasCompleteUnifiedProxy(sender) && isAuthorized("internal-unified")) {
    definitions.push({
      id: "internal-unified",
      label: "内置统一代理",
      mode: "singbox",
      inboundTag: "ai-unified-in",
      outboundTag: "proxy-unified",
      dnsTag: "dns_proxy_unified",
      expected: { ip: "", countryCode: "", asn: "" },
    });
  }

  const managed = Array.isArray(sender.managed_proxy_routes) ? sender.managed_proxy_routes : [];
  const legacy =
    sender.airport_outbound && typeof sender.airport_outbound === "object"
      ? [
          {
            id: "internal-airport",
            name: safeText(sender.airport_name, 80) || "内置机场节点",
            enabled: true,
            outbound: sender.airport_outbound,
          },
        ]
      : [];
  const normalizedManaged = [...managed, ...legacy]
    .map((record) => {
      const id = normalizeAiRouteId(record?.id);
      const outbound =
        record?.outbound && typeof record.outbound === "object" && !Array.isArray(record.outbound)
          ? { ...record.outbound }
          : null;
      if (!id || !outbound || !safeText(outbound.type, 40) || record?.enabled === false)
        return null;
      delete outbound.tag;
      return {
        id,
        name: safeText(record?.name, 80) || id,
        outbound,
        expected:
          record?.expected && typeof record.expected === "object" ? { ...record.expected } : {},
      };
    })
    .filter(Boolean);
  const uniqueManaged = [...new Map(normalizedManaged.map((route) => [route.id, route])).values()];
  for (const route of uniqueManaged) {
    if (route.id === "internal-unified" || !isAuthorized(route.id)) continue;
    const legacyAirport = route.id === "internal-airport";
    const sequence = definitions.length;
    definitions.push({
      id: route.id,
      label: `内置节点 · ${route.name}`,
      mode: "singbox",
      inboundTag: legacyAirport ? "ai-airport-in" : `ai-managed-${sequence}-in`,
      outboundTag: legacyAirport ? "proxy-airport" : `proxy-managed-${sequence}`,
      dnsTag: legacyAirport ? "dns_proxy_airport" : `dns_proxy_managed_${sequence}`,
      outbound: { ...route.outbound },
      expected: { ...route.expected },
    });
  }

  if (definitions.length > 64) throw new Error("内置代理线路不能超过 64 条");
  const usedPorts = new Set([listenPort]);
  const allocatePort = (offset) => {
    let port = listenPort + offset;
    if (port > 65535) port = 1024 + (port - 65536);
    while (usedPorts.has(port)) {
      port += 1;
      if (port > 65535) port = 1024;
    }
    usedPorts.add(port);
    return port;
  };
  return definitions.map((route, index) => ({
    ...route,
    host: "127.0.0.1",
    port: allocatePort(index + 1),
  }));
}

function validateAiRouteIsolation(config, routes) {
  const inbounds = new Map((config?.inbounds || []).map((entry) => [entry?.tag, entry]));
  const outbounds = new Map((config?.outbounds || []).map((entry) => [entry?.tag, entry]));
  const dnsServers = new Map((config?.dns?.servers || []).map((entry) => [entry?.tag, entry]));
  const dnsRules = Array.isArray(config?.dns?.rules) ? config.dns.rules : [];
  const routeRules = Array.isArray(config?.route?.rules) ? config.route.rules : [];
  for (const route of Array.isArray(routes) ? routes : []) {
    if (!inbounds.has(route.inboundTag)) throw new Error(`线路 ${route.id} 缺少独立入站`);
    if (!outbounds.has(route.outboundTag)) throw new Error(`线路 ${route.id} 缺少独立出站`);
    const dnsServer = dnsServers.get(route.dnsTag);
    if (!dnsServer || dnsServer.detour !== route.outboundTag) {
      throw new Error(`线路 ${route.id} 的 DNS 未绑定到同一出站`);
    }
    const hasDnsRule = dnsRules.some(
      (rule) =>
        Array.isArray(rule?.inbound) &&
        rule.inbound.includes(route.inboundTag) &&
        rule.server === route.dnsTag,
    );
    if (!hasDnsRule) throw new Error(`线路 ${route.id} 缺少独立 DNS 路由`);
    const hasRouteRule = routeRules.some(
      (rule) =>
        Array.isArray(rule?.inbound) &&
        rule.inbound.includes(route.inboundTag) &&
        rule.outbound === route.outboundTag,
    );
    if (!hasRouteRule) throw new Error(`线路 ${route.id} 缺少强制出站路由`);
  }
  return true;
}

module.exports = {
  activeAiRouteIds,
  hasCompleteUnifiedProxy,
  internalAiProxyRoutes,
  validateAiRouteIsolation,
  normalizeAiEnvironmentId,
  normalizeAiRouteId,
  managedDefaultRouteId,
  partitionForAiEnvironment,
  resolvedProxyMatchesRoute,
  scaleAiHostBounds,
  shouldCloseAiWorkspacesForEnvironment,
};
