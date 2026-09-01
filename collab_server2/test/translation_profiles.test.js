const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createTranslationProfileService,
  decryptApiKey,
  encryptApiKey,
  isBlockedAddress,
  parseMasterKey,
  resolvePublicEndpoint,
} = require("../translation_profiles");
const { createTranslationUsageService } = require("../translation_usage");

function profilePayload(overrides = {}) {
  return {
    id: "team-default",
    name: "团队默认翻译",
    type: "ai",
    baseUrl: "https://translation.example.com/v1",
    model: "gpt-5-mini",
    effort: "low",
    enabled: true,
    accessMode: "restricted",
    allowedUsernames: ["Alice"],
    apiKey: "server-secret-key",
    pricing: {
      currency: "USD",
      inputPerMillion: 1.25,
      outputPerMillion: 10,
      perRequest: 0.001,
    },
    ...overrides,
  };
}

test("翻译 API Key 使用 AES-GCM 加密且不会进入管理端或客户端响应", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "translation-profiles-"));
  const file = path.join(dir, "profiles.json");
  const key = Buffer.alloc(32, 11).toString("base64");
  const service = createTranslationProfileService({ file, masterKey: key });

  const saved = service.save({ defaultProfileId: "team-default", profiles: [profilePayload()] });
  const stored = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(stored, /server-secret-key/);
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  assert.strictEqual(saved.profiles[0].apiKeyConfigured, true);
  assert.strictEqual(Object.hasOwn(saved.profiles[0], "apiKeyEncrypted"), false);
  assert.strictEqual(Object.hasOwn(saved.profiles[0], "apiKey"), false);

  const publicCatalog = service.publicCatalog({ username: "Alice", isAdmin: false });
  assert.deepStrictEqual(publicCatalog.profiles, [
    { id: "team-default", name: "团队默认翻译", type: "ai", model: "gpt-5-mini" },
  ]);
  assert.strictEqual(JSON.stringify(publicCatalog).includes("translation.example.com"), false);
  assert.deepStrictEqual(
    service.publicCatalog({ username: "alice", isAdmin: false }).profiles,
    [],
    "授权用户名保持服务端确认的大小写语义",
  );
  const unavailable = createTranslationProfileService({ file, masterKey: "" });
  assert.strictEqual(unavailable.adminCatalog().encryptionReady, false);
  assert.deepStrictEqual(
    unavailable.publicCatalog({ username: "Alice", isAdmin: false }).profiles,
    [],
    "主密钥不可用时不能向客户端公布看似可用的配置",
  );
});

test("主密钥错误时无法解密 API Key", () => {
  const correct = parseMasterKey(Buffer.alloc(32, 1).toString("base64"));
  const wrong = parseMasterKey(Buffer.alloc(32, 2).toString("base64"));
  const envelope = encryptApiKey("secret", correct, "profile-a");
  assert.strictEqual(decryptApiKey(envelope, correct, "profile-a"), "secret");
  assert.throws(() => decryptApiKey(envelope, wrong, "profile-a"), /无法解密/);
  assert.throws(() => decryptApiKey(envelope, correct, "profile-b"), /无法解密/);
});

test("托管翻译强制用户授权并以服务端 usage 计算估算费用", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "translation-call-"));
  const file = path.join(dir, "profiles.json");
  const service = createTranslationProfileService({
    file,
    masterKey: Buffer.alloc(32, 3).toString("base64"),
    dependencies: {
      requestJson: async (endpoint, body, headers) => {
        assert.strictEqual(endpoint.toString(), "https://translation.example.com/v1/responses");
        assert.strictEqual(headers.authorization, "Bearer server-secret-key");
        assert.strictEqual(body.store, false);
        return {
          output_text: "Hello",
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        };
      },
    },
  });
  service.save({ profiles: [profilePayload()] });

  await assert.rejects(
    service.translate({ text: "你好" }, { username: "Bob", isAdmin: false }),
    /不存在、未启用或尚未配置密钥/,
  );
  const result = await service.translate(
    { text: "你好", target: "en", style: "natural" },
    { username: "Alice", isAdmin: false },
  );
  assert.strictEqual(result.translatedText, "Hello");
  assert.deepStrictEqual(result.usage, {
    inputChars: 2,
    outputChars: 5,
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    costMicros: 1325,
    currency: "USD",
  });
});

test("翻译上游地址阻止回环、内网、metadata 和 IPv4-mapped IPv6", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.100.100.200",
    "168.63.129.16",
    "::1",
    "fc00::1",
    "::ffff:7f00:1",
  ]) {
    assert.strictEqual(isBlockedAddress(address), true, address);
  }
  await assert.rejects(
    resolvePublicEndpoint(new URL("https://translation.example.com"), async () => [
      { address: "169.254.169.254", family: 4 },
    ]),
    /禁止访问/,
  );
  assert.deepStrictEqual(
    await resolvePublicEndpoint(new URL("https://translation.example.com"), async () => [
      { address: "198.51.100.8", family: 4 },
    ]),
    { address: "198.51.100.8", family: 4 },
  );
});

test("翻译用量只记录元数据、按 requestId 幂等并分币种汇总", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "translation-usage-"));
  const file = path.join(dir, "usage.json");
  const usage = createTranslationUsageService({ file });
  const event = {
    requestId: "request-0001",
    username: "Alice",
    profileId: "team-default",
    profileName: "团队默认翻译",
    inputChars: 10,
    outputChars: 20,
    inputTokens: 3,
    outputTokens: 4,
    totalTokens: 7,
    costMicros: 2500,
    currency: "USD",
  };
  assert.strictEqual(usage.record(event).recorded, true);
  assert.strictEqual(usage.record(event).recorded, false);
  const raw = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(raw, /原文|译文|translatedText|sourceText/);
  const report = usage.query({ username: "Alice" });
  assert.strictEqual(report.totals.requests, 1);
  assert.strictEqual(report.totals.totalTokens, 7);
  assert.deepStrictEqual(report.totals.costByCurrency, { USD: 2500 });
  assert.strictEqual(report.byProfile[0].requests, 1);
  assert.strictEqual(report.byUser[0].username, "Alice");
});
