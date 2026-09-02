const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Backend, resolvePersonalSenderListenPort } = require("../backend");

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

test("sender 配置在同一 sing-box 中固定两条高级 AI 出口", () => {
  const backend = Object.create(Backend.prototype);
  backend.appMode = "sender";
  const config = backend.buildSenderConfig({
    proxy_server: "proxy.example.com",
    proxy_port: "443",
    proxy_uuid: "00000000-0000-4000-8000-000000000000",
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

test("个人 sender 只复用已有代理端点且不装载组织线路", () => {
  const backend = Object.create(Backend.prototype);
  backend.appMode = "sender";
  const config = backend.buildSenderConfig({
    proxy_mode: "personal",
    personal_proxy_protocol: "socks5",
    personal_proxy_host: "127.0.0.1",
    personal_proxy_port: "7890",
    socks_listen_port: "19870",
    fallback_mode: "system_proxy",
    fallback_local_port: "7891",
    proxy_server: "organization.example.com",
    proxy_port: "443",
    proxy_uuid: "organization-credential",
    airport_outbound: {
      type: "socks",
      server: "managed.example.com",
      server_port: 1080,
    },
    managed_proxy_routes: [
      {
        id: "managed-route",
        enabled: true,
        outbound: { type: "socks", server: "managed-2.example.com", server_port: 1080 },
      },
    ],
  });

  assert.deepEqual(
    config.outbounds.find((outbound) => outbound.tag === "proxy-personal"),
    {
      type: "socks",
      tag: "proxy-personal",
      server: "127.0.0.1",
      server_port: 7890,
    },
  );
  assert.equal(
    config.outbounds.some((outbound) => outbound.tag === "proxy-unified"),
    false,
  );
  assert.equal(
    config.outbounds.some((outbound) => outbound.tag === "proxy-airport"),
    false,
  );
  assert.equal(
    config.outbounds.some((outbound) => outbound.tag === "system_proxy"),
    false,
  );
  assert.equal(
    config.inbounds.some((inbound) => inbound.tag !== "socks"),
    false,
  );
  assert.equal(config.route.final, "direct");
  assert.equal(config.dns.final, "dns_local");
});

test("个人 HTTP 代理复用同一 sender runtime 并拒绝内部端口回环", () => {
  const backend = Object.create(Backend.prototype);
  backend.appMode = "sender";
  const config = backend.buildSenderConfig({
    proxy_mode: "personal",
    personal_proxy_protocol: "http",
    personal_proxy_host: "proxy.example.com",
    personal_proxy_port: "8080",
    socks_listen_port: "19871",
  });
  assert.equal(
    config.outbounds.find((outbound) => outbound.tag === "proxy-personal")?.type,
    "http",
  );
  assert.throws(
    () =>
      backend.buildSenderConfig({
        proxy_mode: "personal",
        personal_proxy_host: "127.0.0.1",
        personal_proxy_port: "19871",
        socks_listen_port: "19871",
      }),
    /端口冲突/,
  );
});

test("个人代理端口冲突时由 main 自动分配内部端口", async () => {
  const port = await resolvePersonalSenderListenPort({
    personal_proxy_host: "127.0.0.1",
    personal_proxy_port: "1080",
    socks_listen_port: "1080",
  });
  assert.ok(Number.isInteger(port));
  assert.ok(port >= 1024 && port <= 65535);
  assert.notEqual(port, 1080);
});

test("个人代理运行中重启会复用自己持有的内部端口", async () => {
  const port = await resolvePersonalSenderListenPort(
    {
      personal_proxy_host: "127.0.0.1",
      personal_proxy_port: "7890",
      socks_listen_port: "19870",
    },
    19870,
  );
  assert.equal(port, 19870);
});

test("bundled sing-box 接受个人代理候选配置", (t) => {
  const binary = path.resolve(__dirname, "../../../build/bin/sing-box");
  if (!fs.existsSync(binary)) {
    t.skip("当前平台未提供 bundled sing-box");
    return;
  }
  const backend = Object.create(Backend.prototype);
  backend.appMode = "sender";
  backend.log = () => {};
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-personal-proxy-"));
  const configPath = path.join(temporaryRoot, "candidate.json");
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const config = backend.buildSenderConfig({
    proxy_mode: "personal",
    personal_proxy_protocol: "http",
    personal_proxy_host: "proxy.example.com",
    personal_proxy_port: "8080",
    socks_listen_port: "19872",
  });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  assert.doesNotThrow(() => backend.checkSingboxConfig(binary, configPath, "personal test"));
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
