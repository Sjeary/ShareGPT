// 知识库 AI 助手 (主进程): 调用 OpenAI Responses API (Codex 中转), 流式返回。
// provider {baseUrl, apiKey, model, effort} 由渲染层从本地设置传入, 主进程不持久化密钥。
const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

const SYS =
  "你是中文写作与知识管理助手。直接输出结果本身，不要任何解释、前后缀，也不要用 markdown 代码围栏包裹。";

// 各功能的 user prompt。ctx 可带 titles(库标题) / context(检索片段) 等。
function buildPrompt(mode, text, ctx) {
  const titles = (ctx && Array.isArray(ctx.titles) ? ctx.titles : []).join("\n");
  const context = ctx && typeof ctx.context === "string" ? ctx.context : "";
  switch (mode) {
    case "expand":
      return `扩写下面的内容，保持原有风格与语气，使其更充实具体：\n\n${text}`;
    case "continue":
      return `紧接着下面的内容自然续写一段（只输出续写部分）：\n\n${text}`;
    case "summary":
      return `用简洁的中文要点总结下面的内容：\n\n${text}`;
    case "polish":
      return `润色下面的文字，使其更通顺专业，保持原意与语言：\n\n${text}`;
    case "rewrite":
      return `换一种表达方式改写下面的文字，保持原意：\n\n${text}`;
    case "title":
      return `为下面的内容起一个简洁贴切的标题，只输出标题本身（不加引号）：\n\n${text}`;
    case "translate":
      return ctx && ctx.targetLanguage
        ? `把下面的文字翻译为${ctx.targetLanguage}，只输出译文：\n\n${text}`
        : `翻译下面的文字（中文→英文，英文→中文），只输出译文：\n\n${text}`;
    case "tags":
      return `阅读下面的笔记，给出 3-6 个最贴切的中文标签，用逗号分隔，只输出标签本身（不带 # 不解释）：\n\n${text}`;
    case "linkSuggest":
      return `下面是「当前笔记」内容，以及知识库中「已有笔记标题」列表。请挑选 3-8 个与当前笔记最相关、值得建立双链的已有标题，每行一个，只输出标题原文（要与列表完全一致），不要编号或解释。\n\n当前笔记：\n${text}\n\n已有标题：\n${titles}`;
    case "edit":
      return `你在帮用户编辑一篇 markdown 文档。根据「指令」修改「原文」，直接输出修改后的**完整** markdown 文本本身，保持原有 markdown 风格与结构；不要解释、不要用代码围栏包裹。\n\n指令：${(ctx && ctx.instruction) || ""}\n\n原文：\n${text}`;
    case "generate":
      return `根据下面的要求撰写一段 markdown 内容，直接输出 markdown 文本本身，不要解释、不要用代码围栏包裹：\n\n${(ctx && ctx.instruction) || text}`;
    case "autolink":
      return `下面是知识库的笔记清单（每行：标题 —— 摘要）。请找出彼此主题相关、值得建立双链的笔记对，用于构建知识网络。\n规则：每行输出一对，严格用 " || " 分隔为三段：源标题 || 目标标题 || 简短理由；标题必须与清单完全一致；不要编造不存在的标题；同一对只出现一次；最多 30 对；除这些行外不要输出任何其它内容。\n\n清单：\n${text}`;
    case "ask":
      return `你是用户个人知识库的问答助手。请结合下面的「库内资料」回答问题：可以概括、归纳与合理推断（例如根据笔记标题判断这个库的主题）；只有在资料里确实毫无线索时才说明。用中文清晰作答，回答末尾可另起一行用「来源：」列出引用到的笔记标题。\n\n问题：${text}\n\n${context}`;
    default:
      return text;
  }
}

function endpointFor(baseUrl) {
  const b = String(baseUrl || "").replace(/\/+$/, "");
  if (/\/responses$/.test(b)) return b;
  if (/\/v1$/.test(b)) return b + "/responses";
  return b + "/v1/responses";
}

function createNotesAi({ getWindow }) {
  let counter = 0;
  const live = new Map();
  const MAX_RETRY = 2;

  function emit(streamId, payload) {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send("notes-ai:event", { streamId, ...payload });
  }

  function complete(req) {
    const streamId = `ai_${++counter}`;
    const provider = (req && req.provider) || {};
    const baseUrl = String(provider.baseUrl || "").trim();
    const apiKey = String(provider.apiKey || "").trim();
    const model = String(provider.model || "gpt-5.5").trim();
    const effort = String(provider.effort || "medium").trim();
    if (!baseUrl || !apiKey) {
      setImmediate(() => emit(streamId, { type: "error", message: "未配置 AI 接口地址或密钥" }));
      return { streamId };
    }

    let endpoint;
    try {
      endpoint = new URL(endpointFor(baseUrl));
    } catch {
      setImmediate(() => emit(streamId, { type: "error", message: "接口地址不合法" }));
      return { streamId };
    }
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
      setImmediate(() =>
        emit(streamId, { type: "error", message: "接口地址只支持 HTTP 或 HTTPS" }),
      );
      return { streamId };
    }

    const payload = {
      model,
      instructions: (req && req.instructions) || SYS,
      input: buildPrompt(req.mode, req.text || "", req.ctx),
      stream: true,
      store: false,
    };
    if (effort) payload.reasoning = { effort };
    const body = Buffer.from(JSON.stringify(payload), "utf-8");

    const lib = endpoint.protocol === "http:" ? http : https;
    // 仅在「尚未吐出任何内容」且属于上游过载/限流/瞬时错误时才自动重试,
    // 避免把已经流式输出一半的回答重复一遍。
    const retryable = (code, msg) => {
      if ([429, 500, 502, 503, 504, 529].includes(Number(code))) return true;
      return /overload|rate.?limit|too many|temporar|timeout|busy|unavailable|capacity/i.test(
        String(msg || ""),
      );
    };
    const stream = {
      request: null,
      retryTimer: null,
      attempt: 0,
      terminal: false,
      cancelled: false,
      gotDelta: false,
    };
    live.set(streamId, stream);

    const finishOnce = (payload) => {
      if (stream.terminal || stream.cancelled) return false;
      stream.terminal = true;
      if (stream.retryTimer) clearTimeout(stream.retryTimer);
      stream.retryTimer = null;
      emit(streamId, payload);
      live.delete(streamId);
      return true;
    };

    const scheduleRetry = () => {
      if (stream.cancelled || stream.terminal) return;
      const nextAttempt = stream.attempt + 1;
      const delay = 800 * nextAttempt + 400 * (nextAttempt - 1);
      emit(streamId, {
        type: "status",
        message: `服务繁忙, 正在重试(${nextAttempt}/${MAX_RETRY})…`,
      });
      stream.request = null;
      stream.retryTimer = setTimeout(() => {
        stream.retryTimer = null;
        if (!stream.cancelled && !stream.terminal) send(nextAttempt);
      }, delay);
    };

    const failAttempt = (code, message) => {
      if (stream.cancelled || stream.terminal) return;
      if (!stream.gotDelta && stream.attempt < MAX_RETRY && retryable(code, message)) {
        scheduleRetry();
        return;
      }
      finishOnce({
        type: "error",
        message:
          retryable(code, message) && !stream.gotDelta
            ? `AI 服务繁忙${code ? `(${code})` : ""}, 已重试 ${MAX_RETRY} 次仍失败, 请稍后再试`
            : message || "网络错误",
      });
    };

    const handleSseLine = (line) => {
      const normalized = String(line || "").trim();
      if (!normalized.startsWith("data:")) return;
      const data = normalized.slice(5).trim();
      if (!data || data === "[DONE]" || stream.terminal || stream.cancelled) return;
      try {
        const event = JSON.parse(data);
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          stream.gotDelta = true;
          emit(streamId, { type: "delta", text: event.delta });
        } else if (event.type === "response.completed") {
          finishOnce({ type: "done" });
        } else if (event.type === "response.failed" || event.type === "error") {
          finishOnce({ type: "error", message: event.error?.message || "生成失败" });
        }
      } catch {
        // 非法 SSE 行由上游负责重发；不能与下一行拼接，否则会组成错误 JSON。
      }
    };

    function send(attempt) {
      if (stream.cancelled || stream.terminal) return;
      stream.attempt = attempt;
      let attemptSettled = false;
      const r = lib.request(
        {
          method: "POST",
          hostname: endpoint.hostname,
          port: endpoint.port || (endpoint.protocol === "http:" ? 80 : 443),
          path: endpoint.pathname + endpoint.search,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            Accept: "text/event-stream",
            "Content-Length": body.length,
          },
          timeout: 120000,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            let err = "";
            res.on("data", (c) => (err += c));
            res.on("end", () => {
              if (attemptSettled) return;
              attemptSettled = true;
              failAttempt(res.statusCode, `接口错误 ${res.statusCode}: ${err.slice(0, 300)}`);
            });
            return;
          }
          let buf = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            buf += chunk;
            let idx;
            while ((idx = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, idx).trim();
              buf = buf.slice(idx + 1);
              handleSseLine(line);
            }
          });
          res.on("end", () => {
            if (buf.trim()) handleSseLine(buf);
            if (!attemptSettled) {
              attemptSettled = true;
              finishOnce({ type: "done" });
            }
          });
        },
      );
      r.on("error", (e) => {
        if (attemptSettled || stream.cancelled || stream.terminal) return;
        attemptSettled = true;
        failAttempt(0, e.message || "网络错误");
      });
      r.on("timeout", () => {
        if (attemptSettled || stream.cancelled || stream.terminal) return;
        attemptSettled = true;
        r.destroy();
        failAttempt(0, "请求超时");
      });
      stream.request = r;
      r.end(body);
    }

    send(0);
    return { streamId };
  }

  function cancel(streamId) {
    const stream = live.get(streamId);
    if (stream) {
      stream.cancelled = true;
      if (stream.retryTimer) clearTimeout(stream.retryTimer);
      stream.retryTimer = null;
      try {
        stream.request?.destroy();
      } catch {}
      live.delete(streamId);
    }
    return { ok: true };
  }

  return { complete, cancel };
}

module.exports = { createNotesAi };
