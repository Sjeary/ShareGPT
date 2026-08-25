const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Backend } = require("../backend");

test("高级 AI 线路查找失败时禁止静默换线", () => {
  const backend = Object.create(Backend.prototype);
  backend.activeAiProxyRoutes = [
    { id: "internal-unified", port: 1081 },
    { id: "internal-airport", port: 1082 },
  ];

  assert.equal(backend.getAiProxyRoute("missing-route"), null);
  assert.deepEqual(backend.getAiProxyRoute("internal-unified"), {
    id: "internal-unified",
    port: 1081,
  });
});

test("普通统一代理不依赖高级 AI 线路授权", () => {
  const backend = Object.create(Backend.prototype);
  backend.appMode = "sender";
  const config = backend.buildSenderConfig({
    proxy_server: "proxy.example.com",
    proxy_port: "443",
    proxy_uuid: "00000000-0000-4000-8000-000000000000",
    socks_listen_port: "1080",
    fallback_mode: "direct",
    proxy_mode: "unified",
    authorized_proxy_route_ids: [],
  });

  assert.ok(config.outbounds.some((outbound) => outbound.tag === "proxy-unified"));
  assert.ok(config.route.rules.some((rule) => rule.outbound === "proxy-unified"));
  assert.ok(!config.inbounds.some((inbound) => inbound.tag === "ai-unified-in"));
});

test("sender 配置在同一 sing-box 中固定两条高级 AI 出口", () => {
  const backend = Object.create(Backend.prototype);
  backend.appMode = "sender";
  const config = backend.buildSenderConfig({
    proxy_server: "proxy.example.com",
    proxy_port: "443",
    proxy_uuid: "00000000-0000-4000-8000-000000000000",
    proxy_expected_ip: "203.0.113.7",
    proxy_expected_country: "US",
    socks_listen_port: "1080",
    fallback_mode: "direct",
    proxy_mode: "unified",
    airport_name: "管理员节点",
    airport_outbound: {
      type: "shadowsocks",
      server: "airport.example.com",
      server_port: 8443,
      method: "2022-blake3-aes-128-gcm",
      password: "test-only",
    },
    authorized_proxy_route_ids: ["internal-unified", "internal-airport"],
  });

  assert.ok(config.outbounds.some((outbound) => outbound.tag === "proxy-unified"));
  assert.ok(config.outbounds.some((outbound) => outbound.tag === "proxy-airport"));
  assert.ok(
    config.inbounds.some(
      (inbound) => inbound.tag === "ai-unified-in" && inbound.listen_port === 1081,
    ),
  );
  assert.ok(
    config.inbounds.some(
      (inbound) => inbound.tag === "ai-airport-in" && inbound.listen_port === 1082,
    ),
  );
  assert.ok(
    config.route.rules.some(
      (rule) => rule.inbound?.[0] === "ai-unified-in" && rule.outbound === "proxy-unified",
    ),
  );
  assert.ok(
    config.route.rules.some(
      (rule) => rule.inbound?.[0] === "ai-airport-in" && rule.outbound === "proxy-airport",
    ),
  );
  assert.ok(
    config.dns.servers.some(
      (server) => server.tag === "dns_proxy_unified" && server.detour === "proxy-unified",
    ),
  );
  assert.ok(
    config.dns.servers.some(
      (server) => server.tag === "dns_proxy_airport" && server.detour === "proxy-airport",
    ),
  );
  assert.ok(
    config.dns.rules.some(
      (rule) => rule.inbound?.[0] === "ai-unified-in" && rule.server === "dns_proxy_unified",
    ),
  );
  assert.ok(
    config.dns.rules.some(
      (rule) => rule.inbound?.[0] === "ai-airport-in" && rule.server === "dns_proxy_airport",
    ),
  );
});

test("bundled sing-box 接受多线路候选配置", (t) => {
  const binary = path.resolve(__dirname, "../../../build/bin/sing-box");
  if (!fs.existsSync(binary)) {
    t.skip("当前平台未提供 bundled sing-box");
    return;
  }
  const backend = Object.create(Backend.prototype);
  backend.appMode = "sender";
  backend.log = () => {};
  const managed = Array.from({ length: 4 }, (_, index) => ({
    id: `route-${index + 1}`,
    name: `Route ${index + 1}`,
    enabled: true,
    outbound: {
      type: "socks",
      server: `proxy-${index + 1}.example.com`,
      server_port: 1080,
    },
  }));
  const config = backend.buildSenderConfig({
    proxy_server: "proxy.example.com",
    proxy_port: "443",
    proxy_uuid: "00000000-0000-4000-8000-000000000000",
    socks_listen_port: "19874",
    fallback_mode: "direct",
    proxy_mode: "unified",
    managed_proxy_routes: managed,
    authorized_proxy_route_ids: ["internal-unified", ...managed.map((route) => route.id)],
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-singbox-check-"));
  const configPath = path.join(tempDir, "candidate.json");
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  assert.doesNotThrow(() => backend.checkSingboxConfig(binary, configPath, "test"));
});
