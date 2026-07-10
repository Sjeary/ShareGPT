const https = require("node:https");
const net = require("node:net");
const { SocksProxyAgent } = require("socks-proxy-agent");

const AI_KINDS = new Set(["gpt", "gemini", "claude"]);
const ENVIRONMENT_MODES = new Set(["system", "us", "proxy"]);
const GEOLOCATION_MODES = new Set(["disabled", "proxy"]);
const ENVIRONMENT_BOOTSTRAP_URL =
  "data:text/html;charset=utf-8,%3Cmeta%20charset%3Dutf-8%3E%3Cstyle%3Ehtml%2Cbody%7Bmargin%3A0%3Bheight%3A100%25%3Bbackground%3A%230b1220%7D%3C%2Fstyle%3E";
const TRANSIENT_AI_LOAD_CODES = new Set([-7, -21, -100, -101, -102, -105, -106, -111, -118, -130]);
const TRANSIENT_AI_LOAD_NAMES =
  /ERR_(?:TIMED_OUT|NETWORK_CHANGED|CONNECTION_(?:CLOSED|RESET|REFUSED|TIMED_OUT)|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|TUNNEL_CONNECTION_FAILED|PROXY_CONNECTION_FAILED)/i;

/** @type {any} */
const DEFAULT_BROWSER_PRIVACY_SETTINGS = Object.freeze({
  version: 1,
  syncEnabled: true,
  updatedAt: "",
  environment: {
    mode: "system",
    locale: "en-US",
    acceptLanguages: "en-US,en",
    timezone: "America/Los_Angeles",
    geolocationMode: "disabled",
    autoSyncFromProxy: false,
    latitude: null,
    longitude: null,
    accuracy: null,
    sourceIp: "",
    countryCode: "",
    country: "",
    region: "",
    city: "",
    sourceUpdatedAt: "",
  },
  lastClearedAt: {
    gpt: "",
    gemini: "",
    claude: "",
  },
});

function safeText(value, maxLength = 200) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

function finiteNumber(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function validTimezone(value, fallback = "America/Los_Angeles") {
  const timezone = safeText(value, 80);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return fallback;
  }
}

function validLocale(value, fallback = "en-US") {
  const locale = safeText(value, 40);
  try {
    return Intl.getCanonicalLocales(locale)[0] || fallback;
  } catch {
    return fallback;
  }
}

function normalizeAcceptLanguages(value, locale) {
  const entries = safeText(value, 120)
    .split(",")
    .map((item) => item.trim())
    .filter((item) =>
      /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})?(?:;q=0(?:\.\d{1,3})?|;q=1(?:\.0{1,3})?)?$/.test(item),
    );
  return entries.length ? [...new Set(entries)].join(",") : `${locale},en`;
}

function isTransientAiLoadError(error) {
  const code = Number(error?.code ?? error?.errno);
  if (Number.isFinite(code) && TRANSIENT_AI_LOAD_CODES.has(code)) return true;
  return TRANSIENT_AI_LOAD_NAMES.test(String(error?.message || error || ""));
}

async function loadUrlWithTransientRetry(loadUrl, options = {}) {
  if (typeof loadUrl !== "function") throw new Error("网页加载函数不可用");
  const retries = Math.max(0, Math.min(4, Number.parseInt(String(options.retries ?? 2), 10) || 0));
  const wait =
    typeof options.wait === "function"
      ? options.wait
      : (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
  const retryDelays = Array.isArray(options.retryDelays)
    ? options.retryDelays
    : [350, 900, 1600, 2400];

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await loadUrl();
    } catch (error) {
      if (attempt >= retries || !isTransientAiLoadError(error)) throw error;
      const delayMs = Math.max(0, Number(retryDelays[attempt]) || 0);
      await wait(delayMs);
    }
  }
}

function normalizeBrowserPrivacySettings(raw = {}) {
  /** @type {any} */
  const input = raw && typeof raw === "object" ? raw : {};
  /** @type {any} */
  const environmentInput =
    input.environment && typeof input.environment === "object" ? input.environment : {};
  const locale = validLocale(environmentInput.locale);
  const mode = ENVIRONMENT_MODES.has(environmentInput.mode) ? environmentInput.mode : "system";
  const geolocationMode = GEOLOCATION_MODES.has(environmentInput.geolocationMode)
    ? environmentInput.geolocationMode
    : "disabled";
  const latitude = finiteNumber(environmentInput.latitude, -90, 90);
  const longitude = finiteNumber(environmentInput.longitude, -180, 180);
  const accuracy = finiteNumber(environmentInput.accuracy, 1, 1_000_000);
  /** @type {any} */
  const lastClearedInput =
    input.lastClearedAt && typeof input.lastClearedAt === "object" ? input.lastClearedAt : {};

  return {
    version: /** @type {1} */ (1),
    syncEnabled: input.syncEnabled !== false,
    updatedAt: safeText(input.updatedAt, 40),
    environment: {
      mode,
      locale,
      acceptLanguages: normalizeAcceptLanguages(environmentInput.acceptLanguages, locale),
      timezone: validTimezone(environmentInput.timezone),
      geolocationMode,
      autoSyncFromProxy: Boolean(environmentInput.autoSyncFromProxy),
      latitude,
      longitude,
      accuracy,
      sourceIp: net.isIP(safeText(environmentInput.sourceIp, 80))
        ? safeText(environmentInput.sourceIp, 80)
        : "",
      countryCode: safeText(environmentInput.countryCode, 2).toUpperCase(),
      country: safeText(environmentInput.country, 80),
      region: safeText(environmentInput.region, 80),
      city: safeText(environmentInput.city, 80),
      sourceUpdatedAt: safeText(environmentInput.sourceUpdatedAt, 40),
    },
    lastClearedAt: {
      gpt: safeText(lastClearedInput.gpt, 40),
      gemini: safeText(lastClearedInput.gemini, 40),
      claude: safeText(lastClearedInput.claude, 40),
    },
  };
}

function syncedBrowserPrivacyPayload(raw) {
  const normalized = normalizeBrowserPrivacySettings(raw);
  return {
    version: 1,
    updatedAt: normalized.updatedAt,
    // 只同步用户选择的策略。代理出口检测结果属于设备本地状态，否则另一台设备使用不同
    // 节点时会得到与当前 IP 不一致的时区/位置。
    environment: {
      mode: normalized.environment.mode,
      locale: normalized.environment.locale,
      acceptLanguages: normalized.environment.acceptLanguages,
      geolocationMode: normalized.environment.geolocationMode,
      autoSyncFromProxy: normalized.environment.autoSyncFromProxy,
      ...(normalized.environment.mode === "proxy"
        ? {}
        : { timezone: normalized.environment.timezone }),
    },
  };
}

function mergeSyncedBrowserPrivacy(localRaw, remoteRaw) {
  const local = normalizeBrowserPrivacySettings(localRaw);
  const remoteEnvironment =
    remoteRaw?.environment && typeof remoteRaw.environment === "object"
      ? remoteRaw.environment
      : {};
  const remoteMode = ENVIRONMENT_MODES.has(remoteEnvironment.mode)
    ? remoteEnvironment.mode
    : local.environment.mode;
  const keepLocalProxyDetection = local.environment.mode === "proxy" && remoteMode === "proxy";
  const remote = normalizeBrowserPrivacySettings({
    ...local,
    updatedAt: safeText(remoteRaw?.updatedAt, 40) || local.updatedAt,
    syncEnabled: local.syncEnabled,
    lastClearedAt: local.lastClearedAt,
    environment: {
      ...local.environment,
      mode: remoteMode,
      locale: remoteEnvironment.locale,
      acceptLanguages: remoteEnvironment.acceptLanguages,
      // 跟随代理时必须继续使用本机节点的检测结果；美国预设时区才跨设备同步。
      timezone: remoteMode === "proxy" ? local.environment.timezone : remoteEnvironment.timezone,
      geolocationMode: remoteEnvironment.geolocationMode,
      autoSyncFromProxy: remoteEnvironment.autoSyncFromProxy,
    },
  });
  return {
    ...remote,
    syncEnabled: local.syncEnabled,
    lastClearedAt: local.lastClearedAt,
    environment: {
      ...remote.environment,
      // 节点派生信息只在检测它的设备保留。
      sourceIp: keepLocalProxyDetection ? local.environment.sourceIp : "",
      countryCode: keepLocalProxyDetection ? local.environment.countryCode : "",
      country: keepLocalProxyDetection ? local.environment.country : "",
      region: keepLocalProxyDetection ? local.environment.region : "",
      city: keepLocalProxyDetection ? local.environment.city : "",
      latitude: keepLocalProxyDetection ? local.environment.latitude : null,
      longitude: keepLocalProxyDetection ? local.environment.longitude : null,
      accuracy: keepLocalProxyDetection ? local.environment.accuracy : null,
      sourceUpdatedAt: keepLocalProxyDetection ? local.environment.sourceUpdatedAt : "",
    },
  };
}

function runtimeEnvironment(raw) {
  const settings = normalizeBrowserPrivacySettings(raw);
  const environment = settings.environment;
  const proxyReady = environment.mode === "proxy" && Boolean(environment.sourceUpdatedAt);
  const hasProxyLocation =
    proxyReady &&
    environment.geolocationMode === "proxy" &&
    environment.latitude !== null &&
    environment.longitude !== null;
  return {
    overridden: environment.mode === "us" || proxyReady,
    locale: environment.locale,
    acceptLanguages: environment.acceptLanguages,
    timezone: environment.timezone,
    geolocationEnabled: hasProxyLocation,
    latitude: hasProxyLocation ? environment.latitude : null,
    longitude: hasProxyLocation ? environment.longitude : null,
    accuracy: hasProxyLocation ? environment.accuracy || 50_000 : null,
  };
}

function sendDebuggerCommand(debuggerApi, method, params, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} 执行超时`)), timeoutMs);
    timer.unref?.();
    debuggerApi.sendCommand(method, params).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function applyEnvironmentToWebContents({
  webContents,
  targetSession,
  privacySettings,
  defaultUserAgent,
  systemLanguages,
}) {
  if (!webContents || webContents.isDestroyed?.()) {
    throw new Error("网页视图不可用");
  }
  const environment = runtimeEnvironment(privacySettings);
  const fallbackLanguages = Array.isArray(systemLanguages)
    ? systemLanguages
        .map((item) => safeText(item, 40))
        .filter(Boolean)
        .join(",")
    : "";
  const activeLanguages = environment.overridden
    ? environment.acceptLanguages
    : fallbackLanguages || "en-US";
  const activeUserAgent = safeText(defaultUserAgent, 500) || targetSession.getUserAgent();

  targetSession.setUserAgent(activeUserAgent, activeLanguages);
  webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");

  // 新建 WebContentsView 在首次导航前没有可接收 CDP 命令的 renderer target。
  // 先加载完全本地的空文档，再套环境覆盖，之后才允许调用方访问真实网站。
  if (typeof webContents.getURL === "function" && !safeText(webContents.getURL())) {
    await webContents.loadURL(ENVIRONMENT_BOOTSTRAP_URL);
  }

  const debuggerApi = webContents.debugger;
  if (!debuggerApi.isAttached()) {
    debuggerApi.attach("1.3");
  }

  // 仅覆盖语言环境；不伪造操作系统、硬件或高熵 User-Agent Client Hints。
  await sendDebuggerCommand(debuggerApi, "Emulation.setUserAgentOverride", {
    userAgent: activeUserAgent,
    acceptLanguage: activeLanguages,
  });
  await sendDebuggerCommand(debuggerApi, "Emulation.setTimezoneOverride", {
    timezoneId: environment.overridden ? environment.timezone : "",
  });
  await sendDebuggerCommand(debuggerApi, "Emulation.setLocaleOverride", {
    locale: environment.overridden ? environment.locale : "",
  });
  if (environment.geolocationEnabled) {
    await sendDebuggerCommand(debuggerApi, "Emulation.setGeolocationOverride", {
      latitude: environment.latitude,
      longitude: environment.longitude,
      accuracy: environment.accuracy,
    });
  } else {
    await sendDebuggerCommand(debuggerApi, "Emulation.clearGeolocationOverride");
  }

  return {
    ...environment,
    webRtcPolicy: webContents.getWebRTCIPHandlingPolicy(),
  };
}

async function clearAiSessionData(targetSession, options = {}) {
  if (!targetSession) throw new Error("网页会话不可用");
  const step = typeof options.onStep === "function" ? options.onStep : () => {};

  step("connections");
  await targetSession.closeAllConnections();
  step("browsing-storage");
  // Electron 31 的 clearData() 在 macOS 清理含 Service Worker 的已关闭分区时会触发
  // Chromium 原生崩溃；逐项 clearStorageData + 下方各缓存 API 覆盖同一批网页登录数据且可稳定复测。
  await targetSession.clearStorageData({
    storages: [
      "cookies",
      "filesystem",
      "indexdb",
      "localstorage",
      "shadercache",
      "websql",
      "serviceworkers",
      "cachestorage",
    ],
    quotas: ["temporary", "syncable"],
  });

  /** @type {Array<[string, () => Promise<any>]>} */
  const operations = [
    ["HTTP 认证缓存", () => targetSession.clearAuthCache()],
    ["网络缓存", () => targetSession.clearCache()],
    ["代码缓存", () => targetSession.clearCodeCaches({})],
    ["DNS 缓存", () => targetSession.clearHostResolverCache()],
  ];
  step("caches");
  const results = await Promise.allSettled(operations.map(([, run]) => run()));
  const failed = results
    .map((result, index) => (result.status === "rejected" ? operations[index][0] : ""))
    .filter(Boolean);
  if (failed.length) {
    throw new Error(`以下数据未能清除：${failed.join("、")}`);
  }
  step("flush");
  await targetSession.flushStorageData();
  step("done");
  return { ok: true };
}

function requestText(url, agent, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        agent,
        headers: {
          Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
          "User-Agent": "ShareGPT environment check",
        },
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1024 * 1024) {
            request.destroy(new Error("环境检测响应过大"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
            reject(new Error(`环境检测服务返回 ${response.statusCode || 0}`));
            return;
          }
          resolve(body);
        });
      },
    );
    request.setTimeout(timeoutMs, () => request.destroy(new Error("环境检测超时")));
    request.on("error", reject);
  });
}

function canonicalIp(value) {
  const ip = safeText(value, 80);
  const version = net.isIP(ip);
  if (!version) return "";
  if (version === 4) return ip;
  try {
    return new URL(`http://[${ip}]/`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return ip.toLowerCase();
  }
}

function parseCloudflareTrace(text) {
  const values = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return values;
}

function normalizeDetectedEnvironment(geo, trace) {
  if (!geo || geo.success === false) {
    throw new Error(safeText(geo?.message) || "无法识别代理出口位置");
  }
  const geoIp = canonicalIp(geo.ip);
  const traceIp = canonicalIp(trace.ip);
  if (!geoIp || !traceIp || geoIp !== traceIp) {
    throw new Error("两条独立检测链路返回的出口 IP 不一致，已拒绝更新环境");
  }
  const timezone = validTimezone(geo?.timezone?.id, "");
  if (!timezone) throw new Error("出口位置没有有效的 IANA 时区");
  const latitude = finiteNumber(geo.latitude, -90, 90);
  const longitude = finiteNumber(geo.longitude, -180, 180);
  if (latitude === null || longitude === null) {
    throw new Error("出口位置缺少可用的经纬度");
  }

  return {
    ip: geoIp,
    countryCode: safeText(geo.country_code, 2).toUpperCase(),
    country: safeText(geo.country, 80),
    region: safeText(geo.region, 80),
    city: safeText(geo.city, 80),
    timezone,
    latitude,
    longitude,
    // IP 定位是城市级近似值，不能伪装成精确 GPS；明确给较粗精度避免误导网页。
    accuracy: 50_000,
    checkedAt: new Date().toISOString(),
  };
}

async function detectProxyEnvironment(socksPort, options = {}) {
  const port = Number(socksPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("本地代理端口不合法");
  }
  const agent = options.agent || new SocksProxyAgent(`socks5h://127.0.0.1:${port}`);
  const fetchText = options.fetchText || requestText;
  const [geoText, traceText] = await Promise.all([
    fetchText("https://ipwho.is/", agent),
    fetchText("https://www.cloudflare.com/cdn-cgi/trace", agent),
  ]);
  let geo;
  try {
    geo = JSON.parse(geoText);
  } catch {
    throw new Error("出口位置服务返回了无效数据");
  }
  return normalizeDetectedEnvironment(geo, parseCloudflareTrace(traceText));
}

function isAiKind(value) {
  return AI_KINDS.has(safeText(value, 20));
}

module.exports = {
  DEFAULT_BROWSER_PRIVACY_SETTINGS,
  normalizeBrowserPrivacySettings,
  syncedBrowserPrivacyPayload,
  mergeSyncedBrowserPrivacy,
  runtimeEnvironment,
  ENVIRONMENT_BOOTSTRAP_URL,
  isTransientAiLoadError,
  loadUrlWithTransientRetry,
  applyEnvironmentToWebContents,
  clearAiSessionData,
  parseCloudflareTrace,
  normalizeDetectedEnvironment,
  detectProxyEnvironment,
  isAiKind,
};
