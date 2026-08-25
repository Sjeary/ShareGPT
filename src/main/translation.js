const http = require("node:http");
const https = require("node:https");
const {
  endpointRequestOptions,
  isLoopbackHostname,
  parseEndpoint,
  resolveEndpoint,
} = require("./endpointSecurity");

const MAX_TRANSLATION_CHARS = 30000;
const REQUEST_TIMEOUT_MS = 60000;

function translationAbortError() {
  const error = new Error("翻译请求已取消");
  error.name = "AbortError";
  return error;
}

function translationEndpoint(rawBaseUrl) {
  const url = parseEndpoint(rawBaseUrl, { label: "翻译接口" });
  if (!/\/translate\/?$/.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/translate`;
  }
  return url;
}

function assertOfflineEndpoint(rawBaseUrl) {
  const endpoint = parseEndpoint(rawBaseUrl, { label: "本地离线翻译接口", loopbackOnly: true });
  if (!/\/translate\/?$/.test(endpoint.pathname)) {
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/translate`;
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

async function translateText(request, dependencies = {}) {
  const signal = dependencies.signal;
  if (signal?.aborted) throw translationAbortError();
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
  const record = await resolveEndpoint(endpoint, { lookup: dependencies.lookup });
  if (signal?.aborted) throw translationAbortError();
  const requestImpl =
    endpoint.protocol === "http:"
      ? dependencies.httpRequest || http.request
      : dependencies.httpsRequest || https.request;

  return new Promise((resolve, reject) => {
    let req = null;
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => {
      const error = translationAbortError();
      if (req) req.destroy(error);
      else finish(reject, error);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    try {
      req = requestImpl(
        {
          ...endpointRequestOptions(endpoint, record),
          method: "POST",
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
              finish(reject, new Error(`翻译接口错误 ${res.statusCode || 0}`));
              return;
            }
            try {
              const translatedText = translatedTextFromResponse(JSON.parse(raw));
              finish(resolve, { translatedText });
            } catch (error) {
              finish(reject, error);
            }
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("翻译接口请求超时")));
      req.on("error", (error) => finish(reject, error));
      req.end(body);
    } catch (error) {
      finish(reject, error);
    }
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
