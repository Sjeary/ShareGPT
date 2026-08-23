const test = require("node:test");
const assert = require("node:assert/strict");
const { Backend } = require("../backend");

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
});
