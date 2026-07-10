const test = require("node:test");
const assert = require("node:assert");
const {
  normalizeFingerprintSettings,
  normalizeLocalProfiles,
  buildFingerprintInjectionSource,
  userAgentOverride,
  snapshotDigest,
  newLocalProfile,
  normalizeAiPartition,
  partitionForProfile,
} = require("../browserFingerprint");

test("稳定指纹设置会限制预设和硬件参数范围", () => {
  const normalized = normalizeFingerprintSettings({
    enabled: true,
    preset: "bad",
    hardwareConcurrency: 999,
    deviceMemory: -1,
    screenWidth: 10,
    mediaDevices: "bad",
  });
  assert.strictEqual(normalized.enabled, true);
  assert.strictEqual(normalized.preset, "balanced");
  assert.strictEqual(normalized.hardwareConcurrency, 8);
  assert.strictEqual(normalized.deviceMemory, 8);
  assert.strictEqual(normalized.screenWidth, 1920);
  assert.strictEqual(normalized.mediaDevices, "preserve");
});

test("美国 Windows 预设生成一致的 UA 与高熵 Client Hints", () => {
  const result = userAgentOverride(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.6478.0 Safari/537.36",
    { enabled: true, preset: "us-windows" },
  );
  assert.match(result.userAgent, /Windows NT 10\.0; Win64; x64/);
  assert.strictEqual(result.userAgentMetadata.platform, "Windows");
  assert.strictEqual(result.userAgentMetadata.architecture, "x86");
  assert.strictEqual(result.userAgentMetadata.bitness, "64");
  assert.strictEqual(result.userAgentMetadata.fullVersion, "126.0.6478.0");
});

test("注入脚本不包含原始设备 ID，并按单服务资料 ID 稳定生成", () => {
  const source = buildFingerprintInjectionSource(
    { enabled: true, preset: "us-windows" },
    "gpt-test-profile",
    "gpt",
  );
  assert.match(source, /gpt-test-profile/);
  assert.match(source, /hardwareConcurrency/);
  assert.match(source, /WebGL/);
  assert.doesNotMatch(source, /deviceId/);
  assert.strictEqual(
    source,
    buildFingerprintInjectionSource(
      { enabled: true, preset: "us-windows" },
      "gpt-test-profile",
      "gpt",
    ),
  );
});

test("本机资料 ID 可轮换且不会进入同步默认值", () => {
  const first = newLocalProfile("claude");
  const second = newLocalProfile("claude");
  assert.notStrictEqual(first.id, second.id);
  assert.match(first.id, /^claude-/);
  const normalized = normalizeLocalProfiles({ claude: first });
  assert.strictEqual(normalized.claude.id, first.id);
  assert.strictEqual(normalized.gpt.id, "gpt-standard-v1");
  assert.match(partitionForProfile("claude", first), /^persist:claude-profile-/);
  assert.strictEqual(normalizeAiPartition("gpt", "../../bad"), "persist:gpt-chat");
});

test("快照摘要对同一内容稳定、对差异敏感", () => {
  const base = { page: { browserHash: "a" }, network: { ip: "203.0.113.1" } };
  assert.strictEqual(snapshotDigest(base), snapshotDigest(base));
  assert.notStrictEqual(
    snapshotDigest(base),
    snapshotDigest({ ...base, network: { ip: "203.0.113.2" } }),
  );
});
