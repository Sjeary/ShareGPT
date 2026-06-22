# 内置翻译插件 — 调研报告（仅调研，未实现）

> 目标：在内嵌 AI 网页（ChatGPT/Gemini/Claude）里加一个“好用的翻译”，并且**分情况过代理**
> （翻译接口该走梯子的走梯子，不该走的直连）。本报告对比可选方案、代理路由做法，并给出推荐。
> 结论部分可直接作为后续开发任务的输入。

## 1. 现状与约束（来自代码探查）

- 内嵌网页是原生 **`WebContentsView`**（`src/main/appFactory.js:1038`），每个 AI 种类一个持久化
  分区（`persist:gpt-chat` 等），**没有注入任何 preload / content script**。
- 网页流量通过 `session.setProxy({ proxyRules: 'socks5://127.0.0.1:<port>' })`
  全量走本机 sing-box 的 SOCKS5（`appFactory.js:1410` 一带）。端口 = sender 的 `socks_listen_port`（默认 1080）。
- 已有 IPC `ai:execute-javascript`（`appFactory.js` 内）可在视图里执行任意 JS — 是注入内容脚本的现成通道。
- 右键菜单本次已加（`popupAiContextMenu`，`appFactory.js`），翻译项可挂在这里。
- **根 `package.json` 已依赖 `socks-proxy-agent` 和 `https-proxy-agent`** → 主进程做“分情况过代理的 fetch”几乎零成本。
- Electron 版本 **31.7.7**。

## 2. 三种实现路径对比

### 方案 A：右键“翻译选中/划词翻译” → 调翻译 API（主进程代理 fetch）✅ 推荐

- 流程：右键菜单（或划词气泡）拿到 `params.selectionText` → IPC 到主进程 → 主进程用
  `fetch`/`https` + `socks-proxy-agent` 调翻译 API → 结果回渲染层，以气泡/浮层展示。
- **分情况过代理**天然好做：按 provider 配置“走代理 / 直连”，主进程按需给 agent 套不套 SOCKS。
- 轻量、可控、不依赖 Electron 扩展生态；与现有 `ai:execute-javascript` / 右键菜单无缝衔接。
- 缺点：整页“沉浸式双语对照”需要自己注入脚本（见方案 C），划词翻译则很简单。

### 方案 B：`session.loadExtension` 加载现成翻译扩展（如沉浸式翻译）⚠️ 不推荐（近期）

- Electron 原生扩展支持**有限**：只实现了一小部分 `chrome.*` API，**MV3 尚未原生支持**，
  `loadExtension` 仅能用于持久化分区且**每次启动都要重新 load**。
- 现代翻译扩展（含沉浸式翻译新版）多为 MV3 + 大量 `chrome.*` / background service worker，
  直接 load 大概率跑不起来或功能残缺。
- 第三方 `electron-chrome-extensions`（samuelmaddock/electron-browser-shell）能补齐不少能力，
  但**同样还不支持 MV3**，且引入较重、维护风险高。
- 结论：兼容性不确定、调试成本高，不适合作为首发。

### 方案 C：自注入 content script 做“整页沉浸式翻译”（方案 A 的进阶）

- 用 `ai:execute-javascript` 注入脚本：遍历段落 → 调主进程翻译 API（同样走方案 A 的代理 fetch）
  → 在原文下方插入译文（双语对照）。等价于自己实现一个迷你“沉浸式翻译”。
- 可作为方案 A 之后的增量；先做划词，再做整页。

## 3. “分情况过代理”的路由做法

两种等价手段，推荐前者：

1. **主进程 fetch + 按 provider 选 agent**（推荐）
   - 走代理：`new SocksProxyAgent('socks://127.0.0.1:<socks_listen_port>')` 套到请求上。
   - 直连：不挂 agent。
   - provider→是否过代理 做成一张小配置表，例如：
     - Google 翻译 / DeepL：墙内不可达 → **过代理**。
     - 微软翻译（`api.cognitive.microsofttranslator.com`）：多数地区可直连，也可配过代理。
     - 国内服务（如自建 LibreTranslate / 内网）：**直连**。
   - 端口从 settings 的 `sender.socks_listen_port` 读取，与内嵌网页同一个 sing-box 出口。

2. **专用分区 + `session.setProxy`**：给翻译请求建一个 `persist:translate` 分区单独设代理，
   用 `session.fetch` 发请求。可行但比方案 1 重，且不如直接挂 agent 灵活。

## 4. 翻译后端候选对比（价格/额度需以官网为准，下列为调研快照）

| 后端                               | 免费额度             | 付费价                | 质量           | 墙内可达   | 备注                                  |
| ---------------------------------- | -------------------- | --------------------- | -------------- | ---------- | ------------------------------------- |
| **微软翻译 (Azure Translator)**    | ~**2M 字符/月**免费  | ~$10 / 百万字符       | 好             | 多数可直连 | 免费额度最大，首选                    |
| Google Cloud Translate             | 有限免费             | ~$20 / 百万字符       | 好             | 需过代理   | 质量稳，价偏高                        |
| DeepL API                          | **500k 字符/月**免费 | $25 / 百万字符（Pro） | 很好（中英佳） | 需过代理   | 质量最佳，价最高                      |
| LibreTranslate（自建）             | 自建无限             | 仅服务器成本          | 一般           | 可内网直连 | 开源、可离线、隐私好                  |
| 免费网页端点（Google/MS 公开端点） | 不稳定               | 0                     | 好             | 视端点     | 易被限频，仅原型用                    |
| LLM（OpenAI/Azure/SiliconFlow 等） | 视厂商               | 按 token              | 很好           | 视厂商     | 可复用内嵌 AI 账户思路，质量高但贵/慢 |

## 5. 推荐方案

1. **首发做方案 A（划词/选中翻译，主进程代理 fetch）**：
   - 右键菜单加“翻译选中文字”（已预留菜单位）+ 可选划词气泡。
   - 后端首选**微软翻译免费层**（额度大、质量好、多数可直连），DeepL/Google 作为可选高质量项（默认过代理）。
   - 代理路由用**主进程 `fetch` + `socks-proxy-agent`**，provider 级“走代理/直连”开关，端口取 `sender.socks_listen_port`。
2. **二期做方案 C（整页沉浸式双语）**：复用同一套主进程翻译 + 代理路由，靠 `ai:execute-javascript` 注入对照脚本。
3. **方案 B（加载现成扩展）暂缓**：等 Electron 原生 MV3 支持成熟，或确有必须的扩展再评估。

## 6. 落地时的具体接入点（备忘）

- 右键菜单翻译项：`popupAiContextMenu`（`src/main/appFactory.js`）。
- 新 IPC：`plugin:translate`（主进程实现代理 fetch）+ preload 暴露 + 渲染层气泡组件。
- 代理端口/开关：读 `settings.sender.socks_listen_port` 与新增 provider 配置（可放 `settings.ui` 或新 `settings.plugins`）。
- 整页注入：复用 `ai:execute-javascript`。

## 来源

- [Chrome Extension Support | Electron](https://www.electronjs.org/docs/latest/api/extensions)
- [Support for Manifest V3 Chrome Extensions · electron/electron#49984](https://github.com/electron/electron/issues/49984)
- [electron-chrome-extensions (samuelmaddock/electron-browser-shell)](https://github.com/samuelmaddock/electron-browser-shell/blob/master/packages/electron-chrome-extensions/README.md)
- [LibreTranslate（开源自建翻译 API）](https://github.com/LibreTranslate/LibreTranslate)
- [Immersive Translate — 自定义翻译服务接口](https://immersivetranslate.com/docs/services/)
- [DeepL pricing 2026 (eesel)](https://www.eesel.ai/blog/deepl-pricing)
- [DeepL vs Google vs Microsoft Translator (Taia)](https://taia.io/resources/blog/deepl-vs-google-translate-vs-microsoft-translator/)
