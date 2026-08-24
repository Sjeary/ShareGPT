const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

const MAX_TRANSLATION_CHARS = 30000;
const REQUEST_TIMEOUT_MS = 60000;

function translationEndpoint(rawBaseUrl) {
  const value = String(rawBaseUrl || "").trim();
  if (!value) throw new Error("未配置翻译接口地址");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("翻译接口只支持 HTTP 或 HTTPS");
  }
  if (!/\/translate\/?$/.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/translate`;
  }
  return url;
}

function isLoopbackHostname(hostname) {
  const value = String(hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function assertOfflineEndpoint(rawBaseUrl) {
  const endpoint = translationEndpoint(rawBaseUrl);
  if (!isLoopbackHostname(endpoint.hostname)) {
    throw new Error("本地离线模式只允许连接本机回环地址");
  }
  return endpoint;
}

function translatedTextFromResponse(payload) {
  if (typeof payload?.translatedText === "string") return payload.translatedText;
  if (typeof payload?.translation === "string") return payload.translation;
  if (Array.isArray(payload?.translations) && typeof payload.translations[0]?.text === "string") {
    return payload.translations[0].text;
  }
  throw new Error("翻译接口返回了无法识别的数据");
}

function translateText(request) {
  const mode = String(request?.mode || "api");
  const text = String(request?.text || "").trim();
  if (!text) throw new Error("请输入要翻译的内容");
  if (text.length > MAX_TRANSLATION_CHARS) {
    throw new Error(`翻译内容不能超过 ${MAX_TRANSLATION_CHARS} 个字符`);
  }

  const endpoint =
    mode === "offline"
      ? assertOfflineEndpoint(request?.baseUrl)
      : translationEndpoint(request?.baseUrl);
  const body = Buffer.from(
    JSON.stringify({
      q: text,
      source: String(request?.source || "auto"),
      target: String(request?.target || "zh"),
      format: "text",
      ...(request?.apiKey ? { api_key: String(request.apiKey) } : {}),
    }),
    "utf8",
  );
  const transport = endpoint.protocol === "http:" ? http : https;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        method: "POST",
        hostname: endpoint.hostname,
        port: endpoint.port || undefined,
        path: endpoint.pathname + endpoint.search,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Content-Length": body.length,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
          if (raw.length > 2_000_000) req.destroy(new Error("翻译接口响应过大"));
        });
        res.on("end", () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`翻译接口错误 ${res.statusCode || 0}`));
            return;
          }
          try {
            const translatedText = translatedTextFromResponse(JSON.parse(raw));
            resolve({ translatedText });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("翻译接口请求超时")));
    req.on("error", reject);
    req.end(body);
  });
}

module.exports = {
  MAX_TRANSLATION_CHARS,
  assertOfflineEndpoint,
  isLoopbackHostname,
  translatedTextFromResponse,
  translateText,
  translationEndpoint,
};
