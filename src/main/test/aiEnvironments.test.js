const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hasCompleteUnifiedProxy,
  internalAiProxyRoutes,
  validateAiRouteIsolation,
  normalizeAiEnvironmentId,
  normalizeAiRouteId,
  partitionForAiEnvironment,
  resolvedProxyMatchesRoute,
  scaleAiHostBounds,
  shouldCloseAiWorkspacesForEnvironment,
  evaluateAiRouteHealth,
} = require("../aiEnvironments");

test("高级 AI 环境为每个服务和环境生成独立 partition", () => {
  assert.equal(partitionForAiEnvironment("gpt", "env-work"), "persist:sharegpt-ai-gpt-env-work");
  assert.notEqual(
    partitionForAiEnvironment("gpt", "env-work"),
    partitionForAiEnvironment("gpt", "env-personal"),
  );
  assert.notEqual(
    partitionForAiEnvironment("gpt", "env-work"),
    partitionForAiEnvironment("claude", "env-work"),
  );
});

test("线路健康检查把 DNS、IPv4 和托管线路预期 IP 作为阻断项", () => {
  const route = {
    id: "route-us",
    outboundTag: "proxy-route-us",
    dnsTag: "dns-route-us",
    expected: { ip: "203.0.113.7", countryCode: "US" },
  };
  const detected = {
    ip: "203.0.113.7",
    countryCode: "US",
    asn: "AS64500",
  };
  const passed = evaluateAiRouteHealth(route, detected);
  assert.equal(passed.ok, true);
  assert.equal(passed.checks.dnsConfigured, "passed");
  assert.equal(passed.checks.ipv4EgressObserved, "passed");

  assert.equal(evaluateAiRouteHealth({ ...route, dnsTag: "" }, detected).ok, false);
  assert.equal(evaluateAiRouteHealth({ ...route, expected: {} }, detected).ok, false);
  assert.equal(evaluateAiRouteHealth(route, { ...detected, ip: "2001:db8::1" }).ok, false);

  const unified = { ...route, id: "internal-unified", expected: {} };
  assert.equal(evaluateAiRouteHealth(unified, detected).ok, false);
});

test("高级 AI 环境拒绝可造成 partition 混淆的标识", () => {
  assert.equal(normalizeAiEnvironmentId(" env-work "), "env-work");
  assert.equal(normalizeAiEnvironmentId("../gpt-chat"), "");
  assert.equal(normalizeAiEnvironmentId("env_work"), "");
  assert.throws(() => partitionForAiEnvironment("unknown", "env-work"), /环境标识/);
});

test("高级环境接受服务器签发的稳定线路标识并拒绝不安全标识", () => {
  assert.equal(normalizeAiRouteId("internal-unified"), "internal-unified");
  assert.equal(normalizeAiRouteId("internal-airport"), "internal-airport");
  assert.equal(normalizeAiRouteId("route-managed-03"), "route-managed-03");
  assert.equal(normalizeAiRouteId("../socks5"), "");
  assert.equal(normalizeAiRouteId("route_user_input"), "");
});

test("代理检测必须严格匹配环境指定的 SOCKS 地址和端口", () => {
  const unified = { host: "127.0.0.1", port: 19875 };
  assert.equal(resolvedProxyMatchesRoute("SOCKS5 127.0.0.1:19875", unified), true);
  assert.equal(resolvedProxyMatchesRoute("SOCKS 127.0.0.1:19875; DIRECT", unified), true);
  assert.equal(resolvedProxyMatchesRoute("SOCKS5 127.0.0.1:19876", unified), false);
  assert.equal(resolvedProxyMatchesRoute("DIRECT", unified), false);
  assert.equal(resolvedProxyMatchesRoute("SOCKS5 127.0.0.1:19875", { host: "", port: 0 }), false);
});

test("重复激活同一高级环境时保留网页，仅环境真正变化时关闭", () => {
  const current = [{ environmentId: "env-work" }, { environmentId: "env-work" }];
  assert.equal(shouldCloseAiWorkspacesForEnvironment(current, "env-work"), false);
  assert.equal(shouldCloseAiWorkspacesForEnvironment(current, "env-personal"), true);
  assert.equal(shouldCloseAiWorkspacesForEnvironment([], "env-work"), false);
  assert.equal(shouldCloseAiWorkspacesForEnvironment([{ environmentId: "" }], ""), false);
});

test("外层缩放后的宿主矩形会换算为 Electron 原生视图坐标", () => {
  assert.deepEqual(scaleAiHostBounds({ x: 213, y: 149, width: 967, height: 611 }, 0.8), {
    x: 170,
    y: 119,
    width: 774,
    height: 489,
  });
  assert.deepEqual(scaleAiHostBounds({ x: 10, y: 20, width: 30, height: 40 }, 1), {
    x: 10,
    y: 20,
    width: 30,
    height: 40,
  });
});

test("内置 sing-box 为统一代理和下发节点生成独立回环入口", () => {
  const sender = {
    proxy_server: "proxy.example.com",
    proxy_port: "443",
    proxy_uuid: "00000000-0000-4000-8000-000000000000",
    proxy_expected_ip: "203.0.113.7",
    proxy_expected_country: "US",
    socks_listen_port: "1080",
    airport_name: "管理员节点",
    airport_outbound: { type: "shadowsocks", server: "airport.example.com" },
    authorized_proxy_route_ids: ["internal-unified", "internal-airport"],
  };
  assert.equal(hasCompleteUnifiedProxy(sender), true);
  assert.deepEqual(internalAiProxyRoutes(sender)[0].expected, {
    ip: "203.0.113.7",
    countryCode: "US",
    asn: "",
  });
  assert.deepEqual(
    internalAiProxyRoutes(sender).map(({ id, label, host, port, inboundTag, outboundTag }) => ({
      id,
      label,
      host,
      port,
      inboundTag,
      outboundTag,
    })),
    [
      {
        id: "internal-unified",
        label: "内置统一代理",
        host: "127.0.0.1",
        port: 1081,
        inboundTag: "ai-unified-in",
        outboundTag: "proxy-unified",
      },
      {
        id: "internal-airport",
        label: "内置节点 · 管理员节点",
        host: "127.0.0.1",
        port: 1082,
        inboundTag: "ai-airport-in",
        outboundTag: "proxy-airport",
      },
    ],
  );
});

test("内置线路忽略不完整出站并安全处理端口上界", () => {
  assert.deepEqual(
    internalAiProxyRoutes({
      socks_listen_port: "65535",
      airport_outbound: { type: "socks", server: "managed.example.com" },
      authorized_proxy_route_ids: ["internal-airport"],
    }).map((route) => ({ id: route.id, host: route.host, port: route.port })),
    [{ id: "internal-airport", host: "127.0.0.1", port: 1024 }],
  );
  assert.throws(() => internalAiProxyRoutes({ socks_listen_port: "0" }), /监听端口/);
});

test("多条托管线路动态分配入口且授权撤销后不再生成", () => {
  const managed = Array.from({ length: 5 }, (_, index) => ({
    id: `route-${index + 1}`,
    name: `Route ${index + 1}`,
    enabled: true,
    outbound: { type: "socks", server: `route-${index + 1}.example.com`, server_port: 1080 },
  }));
  const routes = internalAiProxyRoutes({
    socks_listen_port: "19874",
    managed_proxy_routes: managed,
    authorized_proxy_route_ids: ["route-1", "route-3", "route-5"],
  });
  assert.deepEqual(
    routes.map((route) => route.id),
    ["route-1", "route-3", "route-5"],
  );
  assert.strictEqual(new Set(routes.map((route) => route.port)).size, 3);
});

test("线路隔离校验要求入站、出站和 DNS detour 完整对应", () => {
  const route = {
    id: "route-test",
    inboundTag: "ai-managed-0-in",
    outboundTag: "proxy-managed-0",
    dnsTag: "dns_proxy_managed_0",
  };
  const config = {
    inbounds: [{ tag: route.inboundTag }],
    outbounds: [{ tag: route.outboundTag }],
    dns: {
      servers: [{ tag: route.dnsTag, detour: route.outboundTag }],
      rules: [{ inbound: [route.inboundTag], server: route.dnsTag }],
    },
    route: { rules: [{ inbound: [route.inboundTag], outbound: route.outboundTag }] },
  };
  assert.equal(validateAiRouteIsolation(config, [route]), true);
  config.dns.servers[0].detour = "direct";
  assert.throws(() => validateAiRouteIsolation(config, [route]), /DNS 未绑定/);
});
