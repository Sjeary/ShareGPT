const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hasCompleteUnifiedProxy,
  internalAiProxyRoutes,
  normalizeAiEnvironmentId,
  normalizeAiRouteId,
  partitionForAiEnvironment,
  scaleAiHostBounds,
  shouldCloseAiWorkspacesForEnvironment,
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

test("高级 AI 环境拒绝可造成 partition 混淆的标识", () => {
  assert.equal(normalizeAiEnvironmentId(" env-work "), "env-work");
  assert.equal(normalizeAiEnvironmentId("../gpt-chat"), "");
  assert.equal(normalizeAiEnvironmentId("env_work"), "");
  assert.throws(() => partitionForAiEnvironment("unknown", "env-work"), /环境标识/);
});

test("高级环境只接受内置 sing-box 线路标识", () => {
  assert.equal(normalizeAiRouteId("internal-unified"), "internal-unified");
  assert.equal(normalizeAiRouteId("internal-airport"), "internal-airport");
  assert.equal(normalizeAiRouteId("socks5"), "internal-unified");
  assert.equal(normalizeAiRouteId("route-user-input"), "internal-unified");
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
    socks_listen_port: "1080",
    airport_name: "管理员节点",
    airport_outbound: { type: "shadowsocks", server: "airport.example.com" },
  };
  assert.equal(hasCompleteUnifiedProxy(sender), true);
  assert.deepEqual(internalAiProxyRoutes(sender), [
    {
      id: "internal-unified",
      label: "内置统一代理",
      mode: "singbox",
      host: "127.0.0.1",
      port: 1081,
      inboundTag: "ai-unified-in",
      outboundTag: "proxy-unified",
    },
    {
      id: "internal-airport",
      label: "内置节点 · 管理员节点",
      mode: "singbox",
      host: "127.0.0.1",
      port: 1082,
      inboundTag: "ai-airport-in",
      outboundTag: "proxy-airport",
    },
  ]);
});

test("内置线路忽略不完整出站并安全处理端口上界", () => {
  assert.deepEqual(
    internalAiProxyRoutes({
      socks_listen_port: "65535",
      airport_outbound: { type: "socks", server: "managed.example.com" },
    }).map((route) => ({ id: route.id, host: route.host, port: route.port })),
    [{ id: "internal-airport", host: "127.0.0.1", port: 65533 }],
  );
  assert.throws(() => internalAiProxyRoutes({ socks_listen_port: "0" }), /监听端口/);
});
