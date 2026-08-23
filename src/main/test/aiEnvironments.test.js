const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeAiEnvironmentId,
  normalizeAiProxyRoute,
  partitionForAiEnvironment,
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

test("高级线路支持当前代理、直连、系统代理和本机 SOCKS5", () => {
  assert.deepEqual(
    normalizeAiProxyRoute({ mode: "sender", label: "统一代理" }, { host: "127.0.0.1", port: 1080 }),
    { mode: "sender", label: "统一代理", host: "127.0.0.1", port: 1080 },
  );
  assert.deepEqual(normalizeAiProxyRoute({ mode: "direct" }), {
    mode: "direct",
    label: "直连",
  });
  assert.deepEqual(normalizeAiProxyRoute({ mode: "system" }), {
    mode: "system",
    label: "系统代理",
  });
  assert.deepEqual(
    normalizeAiProxyRoute({ mode: "socks5", host: "localhost", port: "7897", label: "美国" }),
    { mode: "socks5", label: "美国", host: "localhost", port: 7897 },
  );
});

test("高级 SOCKS5 线路拒绝远程主机和非法端口", () => {
  assert.throws(
    () => normalizeAiProxyRoute({ mode: "socks5", host: "proxy.example.com", port: 1080 }),
    /只允许本机/,
  );
  assert.throws(
    () => normalizeAiProxyRoute({ mode: "socks5", host: "127.0.0.1", port: 70000 }),
    /端口不合法/,
  );
});
