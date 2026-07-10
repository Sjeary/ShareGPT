const test = require("node:test");
const assert = require("node:assert");
const {
  normalizeBrowserPrivacySettings,
  syncedBrowserPrivacyPayload,
  mergeSyncedBrowserPrivacy,
  runtimeEnvironment,
  ENVIRONMENT_BOOTSTRAP_URL,
  loadUrlWithTransientRetry,
  applyEnvironmentToWebContents,
  clearAiSessionData,
  normalizeDetectedEnvironment,
  detectProxyEnvironment,
} = require("../browserPrivacy");

test("浏览器环境设置会校验模式、时区、语言和位置范围", () => {
  const normalized = normalizeBrowserPrivacySettings({
    environment: {
      mode: "bad",
      locale: "not_a_locale",
      acceptLanguages: "en-US,<script>",
      timezone: "Mars/Olympus",
      geolocationMode: "bad",
      latitude: 999,
      longitude: -999,
    },
  });
  assert.strictEqual(normalized.environment.mode, "system");
  assert.strictEqual(normalized.environment.locale, "en-US");
  assert.strictEqual(normalized.environment.acceptLanguages, "en-US");
  assert.strictEqual(normalized.environment.timezone, "America/Los_Angeles");
  assert.strictEqual(normalized.environment.geolocationMode, "disabled");
  assert.strictEqual(normalized.environment.latitude, null);
  assert.strictEqual(normalized.environment.longitude, null);
});

test("跨设备只同步策略，不包含节点检测结果和本机清理记录", () => {
  const local = normalizeBrowserPrivacySettings({
    updatedAt: "2026-07-10T10:00:00.000Z",
    environment: {
      mode: "proxy",
      sourceIp: "203.0.113.9",
      timezone: "America/New_York",
      latitude: 40.7,
      longitude: -74,
      sourceUpdatedAt: "2026-07-10T09:30:00.000Z",
    },
    lastClearedAt: { claude: "2026-07-10T09:00:00.000Z" },
  });
  const payload = syncedBrowserPrivacyPayload(local);
  assert.strictEqual(Object.hasOwn(payload.environment, "sourceIp"), false);
  assert.strictEqual(Object.hasOwn(payload.environment, "sourceUpdatedAt"), false);
  assert.strictEqual(Object.hasOwn(payload.environment, "timezone"), false);
  assert.strictEqual(Object.hasOwn(payload.environment, "latitude"), false);
  assert.strictEqual(Object.hasOwn(payload.environment, "longitude"), false);
  assert.strictEqual(Object.hasOwn(payload.environment, "country"), false);
  assert.strictEqual(Object.hasOwn(payload, "lastClearedAt"), false);

  const merged = mergeSyncedBrowserPrivacy(local, {
    ...payload,
    environment: {
      ...payload.environment,
      timezone: "America/Chicago",
      sourceIp: "198.51.100.2",
      latitude: 1,
      longitude: 2,
      sourceUpdatedAt: "2099-01-01T00:00:00.000Z",
    },
  });
  assert.strictEqual(merged.environment.sourceIp, "203.0.113.9");
  assert.strictEqual(merged.environment.latitude, 40.7);
  assert.strictEqual(merged.environment.longitude, -74);
  assert.strictEqual(merged.environment.timezone, "America/New_York");
  assert.strictEqual(merged.lastClearedAt.claude, "2026-07-10T09:00:00.000Z");

  const enteringProxyOnAnotherDevice = mergeSyncedBrowserPrivacy(
    {
      ...local,
      environment: { ...local.environment, mode: "system" },
    },
    payload,
  );
  assert.strictEqual(enteringProxyOnAnotherDevice.environment.sourceUpdatedAt, "");
  assert.strictEqual(enteringProxyOnAnotherDevice.environment.latitude, null);
  assert.strictEqual(runtimeEnvironment(enteringProxyOnAnotherDevice).overridden, false);
});

test("只有代理环境且用户允许时才向网页提供出口位置", () => {
  const base = {
    environment: {
      mode: "proxy",
      geolocationMode: "proxy",
      latitude: 37.77,
      longitude: -122.42,
      accuracy: 50000,
      timezone: "America/Los_Angeles",
      sourceUpdatedAt: "2026-07-10T10:00:00.000Z",
    },
  };
  assert.strictEqual(runtimeEnvironment(base).geolocationEnabled, true);
  assert.strictEqual(
    runtimeEnvironment({
      ...base,
      environment: { ...base.environment, sourceUpdatedAt: "" },
    }).overridden,
    false,
    "代理环境尚未同步时不应套用猜测值",
  );
  assert.strictEqual(
    runtimeEnvironment({
      ...base,
      environment: { ...base.environment, geolocationMode: "disabled" },
    }).geolocationEnabled,
    false,
  );
  assert.strictEqual(
    runtimeEnvironment({
      ...base,
      environment: { ...base.environment, mode: "us" },
    }).geolocationEnabled,
    false,
  );
});

test("出口检测必须由两条链路确认同一个 IP", async () => {
  const geo = {
    success: true,
    ip: "203.0.113.10",
    country_code: "US",
    country: "United States",
    region: "California",
    city: "Los Angeles",
    latitude: 34.05,
    longitude: -118.24,
    timezone: { id: "America/Los_Angeles" },
  };
  const detected = normalizeDetectedEnvironment(geo, { ip: "203.0.113.10" });
  assert.strictEqual(detected.timezone, "America/Los_Angeles");
  assert.strictEqual(detected.countryCode, "US");
  assert.throws(() => normalizeDetectedEnvironment(geo, { ip: "198.51.100.2" }), /出口 IP 不一致/);

  const viaInjectedTransport = await detectProxyEnvironment(1080, {
    agent: {},
    fetchText: async (url) =>
      url.includes("ipwho") ? JSON.stringify(geo) : "ip=203.0.113.10\nloc=US\n",
  });
  assert.strictEqual(viaInjectedTransport.ip, "203.0.113.10");
});

test("环境应用会设置语言、时区、地理位置和 WebRTC 防泄漏策略", async () => {
  const commands = [];
  const bootstrapUrls = [];
  let webRtcPolicy = "default";
  const webContents = {
    isDestroyed: () => false,
    getURL: () => "",
    loadURL: async (url) => bootstrapUrls.push(url),
    setWebRTCIPHandlingPolicy: (value) => {
      webRtcPolicy = value;
    },
    getWebRTCIPHandlingPolicy: () => webRtcPolicy,
    debugger: {
      isAttached: () => false,
      attach: () => commands.push(["attach"]),
      sendCommand: async (name, params) => commands.push([name, params]),
    },
  };
  const userAgents = [];
  const targetSession = {
    setUserAgent: (...args) => userAgents.push(args),
    getUserAgent: () => "fallback",
  };
  const result = await applyEnvironmentToWebContents({
    webContents,
    targetSession,
    privacySettings: {
      environment: {
        mode: "proxy",
        locale: "en-US",
        acceptLanguages: "en-US,en",
        timezone: "America/Los_Angeles",
        geolocationMode: "proxy",
        latitude: 34.05,
        longitude: -118.24,
        accuracy: 50000,
        sourceUpdatedAt: "2026-07-10T10:00:00.000Z",
      },
    },
    defaultUserAgent: "Chrome test",
    systemLanguages: ["zh-CN"],
  });
  assert.deepStrictEqual(userAgents[0], ["Chrome test", "en-US,en"]);
  assert.strictEqual(result.webRtcPolicy, "disable_non_proxied_udp");
  assert.deepStrictEqual(bootstrapUrls, [ENVIRONMENT_BOOTSTRAP_URL]);
  assert.doesNotMatch(
    decodeURIComponent(ENVIRONMENT_BOOTSTRAP_URL),
    /environment bootstrap|title/i,
  );
  assert.deepStrictEqual(commands[2], [
    "Emulation.setTimezoneOverride",
    { timezoneId: "America/Los_Angeles" },
  ]);
  assert.strictEqual(commands.at(-1)[0], "Emulation.setGeolocationOverride");
});

test("AI 页面瞬时超时会重试，永久错误不会循环请求", async () => {
  let attempts = 0;
  const waits = [];
  const result = await loadUrlWithTransientRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw Object.assign(new Error("ERR_TIMED_OUT (-7)"), { code: -7 });
      }
      return "loaded";
    },
    { retries: 2, wait: async (delayMs) => waits.push(delayMs) },
  );
  assert.strictEqual(result, "loaded");
  assert.strictEqual(attempts, 3);
  assert.deepStrictEqual(waits, [350, 900]);

  let permanentAttempts = 0;
  await assert.rejects(
    loadUrlWithTransientRetry(async () => {
      permanentAttempts += 1;
      throw new Error("ERR_ACCESS_DENIED");
    }),
    /ERR_ACCESS_DENIED/,
  );
  assert.strictEqual(permanentAttempts, 1);
});

test("单个会话清理覆盖浏览数据、认证、网络、代码和 DNS 缓存", async () => {
  const calls = [];
  const targetSession = {
    closeAllConnections: async () => calls.push("connections"),
    clearStorageData: async () => calls.push("storage"),
    clearAuthCache: async () => calls.push("auth"),
    clearCache: async () => calls.push("cache"),
    clearCodeCaches: async () => calls.push("code"),
    clearHostResolverCache: async () => calls.push("dns"),
    flushStorageData: async () => calls.push("flush"),
  };
  await clearAiSessionData(targetSession);
  assert.deepStrictEqual(
    new Set(calls),
    new Set(["connections", "storage", "auth", "cache", "code", "dns", "flush"]),
  );
});
