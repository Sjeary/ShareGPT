const crypto = require("node:crypto");

const FINGERPRINT_PRESETS = new Set(["balanced", "us-windows"]);
const AI_KINDS = ["gpt", "gemini", "claude"];
const DEFAULT_PARTITIONS = Object.freeze({
  gpt: "persist:gpt-chat",
  gemini: "persist:gemini-chat",
  claude: "persist:claude-chat",
});

const DEFAULT_FINGERPRINT_SETTINGS = Object.freeze({
  enabled: false,
  preset: "balanced",
  hardwareConcurrency: 8,
  deviceMemory: 8,
  screenWidth: 1920,
  screenHeight: 1080,
  availableHeight: 1040,
  devicePixelRatio: 1,
  colorDepth: 24,
  maxTouchPoints: 0,
  canvasNoise: true,
  audioNoise: true,
  mediaDevices: "preserve",
});

const DEFAULT_LOCAL_PROFILES = Object.freeze({
  gpt: { id: "gpt-standard-v1", rebuiltAt: "" },
  gemini: { id: "gemini-standard-v1", rebuiltAt: "" },
  claude: { id: "claude-standard-v1", rebuiltAt: "" },
});

const PAGE_AUDIT_SOURCE = String.raw`
(async () => {
  const text = (value, max = 1000) => String(value ?? '').slice(0, max);
  const digest = async (value) => {
    try {
      const bytes = new TextEncoder().encode(String(value));
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      const input = String(value);
      const parts = [];
      for (let round = 0; round < 8; round += 1) {
        let hash = (2166136261 ^ round) >>> 0;
        for (let i = 0; i < input.length; i += 1) {
          hash ^= input.charCodeAt(i) + round;
          hash = Math.imul(hash, 16777619) >>> 0;
        }
        parts.push(hash.toString(16).padStart(8, '0'));
      }
      return parts.join('');
    }
  };
  const timezone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
      return '';
    }
  })();
  const uaData = navigator.userAgentData;
  let highEntropy = {};
  if (uaData && typeof uaData.getHighEntropyValues === 'function') {
    try {
      highEntropy = await uaData.getHighEntropyValues([
        'architecture',
        'bitness',
        'formFactors',
        'fullVersionList',
        'model',
        'platformVersion',
        'uaFullVersion',
        'wow64',
      ]);
    } catch {}
  }

  let webglVendor = '';
  let webglRenderer = '';
  let webglVersion = '';
  let canvasHash = '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 80;
    const context = canvas.getContext('2d');
    if (context) {
      const gradient = context.createLinearGradient(0, 0, 320, 80);
      gradient.addColorStop(0, '#4285f4');
      gradient.addColorStop(0.5, '#d97757');
      gradient.addColorStop(1, '#10a37f');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 320, 80);
      context.fillStyle = '#fff';
      context.font = '18px Arial, sans-serif';
      context.fillText('ShareGPT fingerprint audit 1.0', 12, 34);
      context.strokeStyle = '#111';
      context.arc(278, 40, 24, 0, Math.PI * 2);
      context.stroke();
      canvasHash = await digest(canvas.toDataURL('image/png'));
    }
    const glCanvas = document.createElement('canvas');
    const gl = glCanvas.getContext('webgl') || glCanvas.getContext('experimental-webgl');
    if (gl) {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      webglVendor = text(debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
      webglRenderer = text(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      webglVersion = text(gl.getParameter(gl.VERSION));
    }
  } catch {}

  let audioHash = '';
  let audioSampleRate = null;
  try {
    const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (Offline) {
      const audio = new Offline(1, 44100, 44100);
      const oscillator = audio.createOscillator();
      const compressor = audio.createDynamicsCompressor();
      oscillator.type = 'triangle';
      oscillator.frequency.value = 10000;
      oscillator.connect(compressor);
      compressor.connect(audio.destination);
      oscillator.start(0);
      const rendered = await audio.startRendering();
      audioSampleRate = rendered.sampleRate;
      const samples = rendered.getChannelData(0);
      const picked = [];
      for (let i = 4500; i < Math.min(samples.length, 9000); i += 97) picked.push(samples[i]);
      audioHash = await digest(picked.join(','));
    }
  } catch {}

  const fontCandidates = [
    'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Comic Sans MS', 'Courier New',
    'Georgia', 'Helvetica', 'Menlo', 'Microsoft YaHei', 'PingFang SC', 'Roboto',
    'Segoe UI', 'SF Pro Display', 'Tahoma', 'Times New Roman', 'Trebuchet MS',
    'Verdana', 'Noto Sans', 'Noto Sans CJK SC',
  ];
  const fonts = [];
  try {
    const fontCanvas = document.createElement('canvas');
    const fontContext = fontCanvas.getContext('2d');
    const sample = 'mmmmmmmmmmlliWW@#0123456789';
    const fallbacks = ['monospace', 'sans-serif', 'serif'];
    const baseline = {};
    if (fontContext) {
      for (const fallback of fallbacks) {
        fontContext.font = '72px ' + fallback;
        baseline[fallback] = fontContext.measureText(sample).width;
      }
    }
    for (const font of fontCandidates) {
      const safeFont = font.replace(/"/g, '');
      const detected = fontContext && fallbacks.some((fallback) => {
        fontContext.font = '72px "' + safeFont + '",' + fallback;
        return Math.abs(fontContext.measureText(sample).width - baseline[fallback]) > 0.01;
      });
      if (detected) fonts.push(font);
    }
  } catch {}

  const media = { audioInputs: 0, audioOutputs: 0, videoInputs: 0, labelsExposed: false };
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices?.();
    for (const device of devices || []) {
      if (device.kind === 'audioinput') media.audioInputs += 1;
      else if (device.kind === 'audiooutput') media.audioOutputs += 1;
      else if (device.kind === 'videoinput') media.videoInputs += 1;
      if (device.label) media.labelsExposed = true;
    }
  } catch {}

  const webRtc = { candidateTypes: [], hostCandidates: 0, localIpExposed: false };
  try {
    const peer = new RTCPeerConnection({ iceServers: [] });
    peer.createDataChannel('audit');
    peer.onicecandidate = (event) => {
      const candidate = text(event.candidate?.candidate, 500);
      if (!candidate) return;
      const type = candidate.match(/ typ ([a-z]+)/i)?.[1]?.toLowerCase() || 'unknown';
      if (!webRtc.candidateTypes.includes(type)) webRtc.candidateTypes.push(type);
      if (type === 'host') webRtc.hostCandidates += 1;
      if (/(?:^|\s)(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/.test(candidate)) {
        webRtc.localIpExposed = true;
      }
    };
    await peer.setLocalDescription(await peer.createOffer());
    await new Promise((resolve) => setTimeout(resolve, 700));
    peer.close();
    webRtc.candidateTypes.sort();
  } catch {}

  const page = {
    origin: (() => { try { return location.origin; } catch { return ''; } })(),
    capturedAt: new Date().toISOString(),
    locale: {
      language: text(navigator.language, 80),
      languages: Array.from(navigator.languages || []).map((item) => text(item, 80)).slice(0, 12),
      timezone: text(timezone, 100),
      timezoneOffset: new Date().getTimezoneOffset(),
    },
    navigator: {
      userAgent: text(navigator.userAgent, 600),
      platform: text(navigator.platform, 100),
      vendor: text(navigator.vendor, 100),
      cookieEnabled: Boolean(navigator.cookieEnabled),
      webdriver: Boolean(navigator.webdriver),
      hardwareConcurrency: Number(navigator.hardwareConcurrency) || null,
      deviceMemory: Number(navigator.deviceMemory) || null,
      maxTouchPoints: Number(navigator.maxTouchPoints) || 0,
      userAgentData: uaData ? {
        brands: Array.from(uaData.brands || []).map((item) => ({ brand: text(item.brand, 80), version: text(item.version, 40) })),
        mobile: Boolean(uaData.mobile),
        platform: text(uaData.platform, 80),
        highEntropy,
      } : null,
    },
    screen: {
      width: Number(screen.width) || null,
      height: Number(screen.height) || null,
      availWidth: Number(screen.availWidth) || null,
      availHeight: Number(screen.availHeight) || null,
      colorDepth: Number(screen.colorDepth) || null,
      pixelDepth: Number(screen.pixelDepth) || null,
      devicePixelRatio: Number(globalThis.devicePixelRatio) || 1,
      innerWidth: Number(globalThis.innerWidth) || null,
      innerHeight: Number(globalThis.innerHeight) || null,
    },
    graphics: { webglVendor, webglRenderer, webglVersion, canvasHash },
    audio: { hash: audioHash, sampleRate: audioSampleRate },
    fonts: { available: fonts, count: fonts.length, hash: await digest(fonts.join('|')) },
    media,
    webRtc,
  };
  page.browserHash = await digest(JSON.stringify({
    locale: page.locale,
    navigator: page.navigator,
    screen: page.screen,
    graphics: page.graphics,
    audio: page.audio,
    fonts: page.fonts,
    media: page.media,
  }));
  return page;
})()
`;

function safeText(value, maxLength = 500) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

function numberInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

function normalizeFingerprintSettings(raw = {}) {
  const input = /** @type {Record<string, any>} */ (raw && typeof raw === "object" ? raw : {});
  const preset = FINGERPRINT_PRESETS.has(input.preset) ? input.preset : "balanced";
  const mediaDevices = input.mediaDevices === "empty" ? "empty" : "preserve";
  return {
    enabled: input.enabled === true,
    preset,
    hardwareConcurrency: Math.round(numberInRange(input.hardwareConcurrency, 2, 32, 8)),
    deviceMemory: numberInRange(input.deviceMemory, 2, 32, 8),
    screenWidth: Math.round(numberInRange(input.screenWidth, 1024, 7680, 1920)),
    screenHeight: Math.round(numberInRange(input.screenHeight, 720, 4320, 1080)),
    availableHeight: Math.round(numberInRange(input.availableHeight, 680, 4320, 1040)),
    devicePixelRatio: numberInRange(input.devicePixelRatio, 1, 4, 1),
    colorDepth: Math.round(numberInRange(input.colorDepth, 16, 32, 24)),
    maxTouchPoints: Math.round(numberInRange(input.maxTouchPoints, 0, 10, 0)),
    canvasNoise: input.canvasNoise !== false,
    audioNoise: input.audioNoise !== false,
    mediaDevices,
  };
}

function normalizeLocalProfiles(raw = {}) {
  const input = /** @type {Record<string, any>} */ (raw && typeof raw === "object" ? raw : {});
  return Object.fromEntries(
    AI_KINDS.map((kind) => {
      const profile = /** @type {Record<string, any>} */ (
        input[kind] && typeof input[kind] === "object" ? input[kind] : {}
      );
      return [
        kind,
        {
          id: safeText(profile.id, 100) || DEFAULT_LOCAL_PROFILES[kind].id,
          rebuiltAt: safeText(profile.rebuiltAt, 40),
        },
      ];
    }),
  );
}

function profileRuntimeConfig(settings, profileId, kind) {
  const normalized = normalizeFingerprintSettings(settings);
  const usWindows = normalized.preset === "us-windows";
  return {
    ...normalized,
    profileId: safeText(profileId, 100) || `${safeText(kind, 20)}-standard-v1`,
    kind: safeText(kind, 20),
    platform: usWindows ? "Win32" : "",
    webglVendor: usWindows ? "Google Inc. (Intel)" : "",
    webglRenderer: usWindows
      ? "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)"
      : "",
    mediaDevices: usWindows ? "empty" : normalized.mediaDevices,
  };
}

function buildFingerprintInjectionSource(settings, profileId, kind) {
  const config = profileRuntimeConfig(settings, profileId, kind);
  return `(() => {
    const next = ${JSON.stringify(config)};
    const marker = Symbol.for('sharegpt.fingerprint.standardizer.v1');
    const root = globalThis;
    const existing = root[marker];
    if (existing) {
      existing.config = next;
      return;
    }
    if (!next.enabled) return;
    const state = { config: next };
    Object.defineProperty(root, marker, { value: state, configurable: false });
    const active = () => state.config && state.config.enabled;
    const define = (target, key, getter) => {
      try {
        const current = Object.getOwnPropertyDescriptor(target, key);
        if (current && current.configurable === false) return;
        Object.defineProperty(target, key, { configurable: true, enumerable: current?.enumerable ?? true, get: getter });
      } catch {}
    };
    const hash = (value) => {
      let output = 2166136261;
      for (let i = 0; i < value.length; i += 1) {
        output ^= value.charCodeAt(i);
        output = Math.imul(output, 16777619);
      }
      return output >>> 0;
    };
    const seed = () => hash(String(state.config.profileId || '') + ':' + String(state.config.kind || ''));

    const nativeNavigator = {
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      maxTouchPoints: navigator.maxTouchPoints,
      platform: navigator.platform,
    };
    define(Navigator.prototype, 'hardwareConcurrency', function () {
      return active() ? state.config.hardwareConcurrency : nativeNavigator.hardwareConcurrency;
    });
    define(Navigator.prototype, 'deviceMemory', function () {
      return active() ? state.config.deviceMemory : nativeNavigator.deviceMemory;
    });
    define(Navigator.prototype, 'maxTouchPoints', function () {
      return active() ? state.config.maxTouchPoints : nativeNavigator.maxTouchPoints;
    });
    define(Navigator.prototype, 'platform', function () {
      return active() && state.config.platform ? state.config.platform : nativeNavigator.platform;
    });
    const nativeScreen = {
      width: screen.width, height: screen.height, availWidth: screen.availWidth,
      availHeight: screen.availHeight, colorDepth: screen.colorDepth, pixelDepth: screen.pixelDepth,
    };
    define(Screen.prototype, 'width', () => active() ? state.config.screenWidth : nativeScreen.width);
    define(Screen.prototype, 'height', () => active() ? state.config.screenHeight : nativeScreen.height);
    define(Screen.prototype, 'availWidth', () => active() ? state.config.screenWidth : nativeScreen.availWidth);
    define(Screen.prototype, 'availHeight', () => active() ? state.config.availableHeight : nativeScreen.availHeight);
    define(Screen.prototype, 'colorDepth', () => active() ? state.config.colorDepth : nativeScreen.colorDepth);
    define(Screen.prototype, 'pixelDepth', () => active() ? state.config.colorDepth : nativeScreen.pixelDepth);
    const nativeDpr = root.devicePixelRatio;
    define(root, 'devicePixelRatio', () => active() ? state.config.devicePixelRatio : nativeDpr);

    for (const ctor of [root.WebGLRenderingContext, root.WebGL2RenderingContext]) {
      const proto = ctor && ctor.prototype;
      if (!proto || !proto.getParameter) continue;
      const original = proto.getParameter;
      proto.getParameter = function (parameter) {
        if (active() && state.config.webglVendor && parameter === 0x9245) return state.config.webglVendor;
        if (active() && state.config.webglRenderer && parameter === 0x9246) return state.config.webglRenderer;
        return original.call(this, parameter);
      };
    }

    const canvasProto = root.HTMLCanvasElement && root.HTMLCanvasElement.prototype;
    if (canvasProto && canvasProto.toDataURL) {
      const originalToDataURL = canvasProto.toDataURL;
      canvasProto.toDataURL = function (...args) {
        if (!active() || !state.config.canvasNoise || !this.width || !this.height) {
          return originalToDataURL.apply(this, args);
        }
        const context = this.getContext('2d', { willReadFrequently: true });
        if (!context || this.width * this.height > 1000000) return originalToDataURL.apply(this, args);
        const x = seed() % this.width;
        const y = Math.floor(seed() / 97) % this.height;
        try {
          const pixel = context.getImageData(x, y, 1, 1);
          const original = new Uint8ClampedArray(pixel.data);
          pixel.data[seed() % 3] ^= 1;
          context.putImageData(pixel, x, y);
          const value = originalToDataURL.apply(this, args);
          pixel.data.set(original);
          context.putImageData(pixel, x, y);
          return value;
        } catch {
          return originalToDataURL.apply(this, args);
        }
      };
    }

    const audioProto = root.AudioBuffer && root.AudioBuffer.prototype;
    if (audioProto && audioProto.getChannelData) {
      const originalGetChannelData = audioProto.getChannelData;
      audioProto.getChannelData = function (...args) {
        const values = originalGetChannelData.apply(this, args);
        if (!active() || !state.config.audioNoise) return values;
        const copy = new Float32Array(values);
        const step = 97 + (seed() % 31);
        const epsilon = ((seed() % 7) + 1) * 1e-8;
        for (let i = seed() % step; i < copy.length; i += step) copy[i] += epsilon;
        return copy;
      };
    }

    const media = navigator.mediaDevices;
    if (media && typeof media.enumerateDevices === 'function') {
      const originalEnumerate = media.enumerateDevices.bind(media);
      media.enumerateDevices = function () {
        if (active() && state.config.mediaDevices === 'empty') return Promise.resolve([]);
        return originalEnumerate();
      };
    }
  })();`;
}

function userAgentOverride(activeUserAgent, settings) {
  const normalized = normalizeFingerprintSettings(settings);
  const original = safeText(activeUserAgent, 600);
  if (!normalized.enabled || normalized.preset !== "us-windows") {
    return { userAgent: original, userAgentMetadata: null };
  }
  const chromeVersion = original.match(/Chrome\/([\d.]+)/i)?.[1] || "126.0.0.0";
  const major = chromeVersion.split(".")[0] || "126";
  const userAgent = original.replace(/\([^)]*\)/, "(Windows NT 10.0; Win64; x64)");
  return {
    userAgent,
    userAgentMetadata: {
      brands: [
        { brand: "Not/A)Brand", version: "8" },
        { brand: "Chromium", version: major },
        { brand: "Google Chrome", version: major },
      ],
      fullVersionList: [
        { brand: "Not/A)Brand", version: "8.0.0.0" },
        { brand: "Chromium", version: chromeVersion },
        { brand: "Google Chrome", version: chromeVersion },
      ],
      fullVersion: chromeVersion,
      platform: "Windows",
      platformVersion: "10.0.0",
      architecture: "x86",
      model: "",
      mobile: false,
      bitness: "64",
      wow64: false,
    },
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

async function collectPageFingerprint(webContents, timeoutMs = 15_000) {
  if (!webContents || webContents.isDestroyed?.()) throw new Error("网页视图不可用");
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("网页指纹采集超时")), timeoutMs);
    timer.unref?.();
  });
  const result = await Promise.race([
    webContents.executeJavaScript(PAGE_AUDIT_SOURCE, true),
    timeout,
  ]);
  if (!result || typeof result !== "object") throw new Error("网页没有返回可用的指纹摘要");
  return result;
}

function snapshotDigest(snapshot) {
  const payload = snapshot && typeof snapshot === "object" ? snapshot : {};
  return sha256(
    JSON.stringify({
      page: payload.page,
      network: payload.network,
      webRtcPolicy: payload.webRtcPolicy,
      profile: payload.profile,
    }),
  );
}

function newLocalProfile(kind) {
  const prefix = AI_KINDS.includes(kind) ? kind : "ai";
  return {
    id: `${prefix}-${crypto.randomUUID()}`,
    rebuiltAt: new Date().toISOString(),
  };
}

function normalizeAiPartition(kind, value) {
  const targetKind = AI_KINDS.includes(kind) ? kind : "gpt";
  const candidate = safeText(value, 110);
  return /^persist:[a-z0-9][a-z0-9-]{0,95}$/i.test(candidate)
    ? candidate
    : DEFAULT_PARTITIONS[targetKind];
}

function partitionForProfile(kind, profile) {
  const targetKind = AI_KINDS.includes(kind) ? kind : "gpt";
  const rawId = safeText(profile?.id, 100);
  const suffix = rawId
    .replace(new RegExp(`^${targetKind}-`, "i"), "")
    .replace(/[^a-z0-9-]/gi, "")
    .slice(0, 72);
  return normalizeAiPartition(
    targetKind,
    suffix ? `persist:${targetKind}-profile-${suffix}` : DEFAULT_PARTITIONS[targetKind],
  );
}

module.exports = {
  DEFAULT_FINGERPRINT_SETTINGS,
  DEFAULT_LOCAL_PROFILES,
  normalizeFingerprintSettings,
  normalizeLocalProfiles,
  buildFingerprintInjectionSource,
  userAgentOverride,
  collectPageFingerprint,
  snapshotDigest,
  newLocalProfile,
  normalizeAiPartition,
  partitionForProfile,
};
