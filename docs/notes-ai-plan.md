# 知识库 AI 助手 · 调研与方案（待确认后实施）

> 你的选择：用 **Codex 的 API**；**先调研参考实现 + 出方案确认**再写；功能 = 写作辅助 + AI 双链建议 + RAG 问答 + 自动标签/摘要。
> 2026-06-23。

## 1. 调研结论

### Codex 怎么调用（关键）

- **GPT-5-Codex 只在 Responses API（`/v1/responses`）提供**；**`chat/completions` 已在 2026-02 对 Codex 弃用/移除**。
  → 不能用旧的 chat/completions 形态，必须用 **Responses API**：请求体大致 `{ model, instructions, input, stream: true }`；流式是 SSE 事件（`response.output_text.delta` 增量、`response.completed` 收尾）。
- 鉴权：`Authorization: Bearer <API key>`（CODEX_API_KEY / OpenAI key）；自定义供应商可指定 `base_url`。
- **我需要你提供**：① base URL（默认 `https://api.openai.com/v1`，若你用中转/自建填它）② API key ③ 模型名（如 `gpt-5-codex`）。给我后我按 Responses API 实现并走发送代理出网。
- 来源：[OpenAI Responses API / Codex models](https://developers.openai.com/codex/models)、[Codex 认证](https://developers.openai.com/codex/auth)、[弃用 chat/completions 讨论](https://github.com/openai/codex/discussions/7782)。

### 参考实现（借鉴交互，不照搬代码）

- **Obsidian Copilot**：Vault QA = RAG（**词法检索 + 语义向量(Orama)** 取相关片段 → 喂给模型 → **带来源引用**指回具体笔记）。
- **Text Generator**：**模板化 prompt**，`{{context}}` = 选中文本；模板管理器。
- 借鉴点：① 选中文本作上下文 ② 回答附**来源引用** ③ prompt 模板化 ④ RAG 先词法后语义。
- 来源：[obsidian-copilot](https://github.com/logancyang/obsidian-copilot)、[Vault QA 文档](https://www.obsidiancopilot.com/en/docs/vault-qa)、[text-generator](https://github.com/nhaouari/obsidian-textgenerator-plugin)。

## 2. 方案

### 接入

- 主进程 `notesAi`：调 **Responses API**（`/v1/responses`，`stream:true`），SSE 解析 `response.output_text.delta`；经发送代理（SOCKS）出网；provider 配置（baseUrl/apiKey/model）由渲染层从本地设置读出后传入，**密钥仅存本机 settings，不上传**。
- 渲染层 `ai.complete({mode, text, ctx, provider})` → 流式事件 `notes-ai:event`（delta/done/error）。

### 功能（你选的四项）

1. **写作辅助**：选中文字浮起工具条 + 右栏「AI」助手；扩写/续写/总结/润色/改写/起标题/翻译；流式输出；结果可**替换/插入/追加/丢弃**。
2. **AI 双链建议**：读当前笔记 + 全库标题 → 推荐应建双链的已有笔记 → 一键插入 `[[ ]]` 或跳转（回填图谱）。
3. **RAG 问答**：对整库提问 → 用**已有的 MiniSearch 词法检索** top-K 笔记片段 → 拼进 Responses `input` → 流式回答 + **来源引用**（可点开）。MVP 用词法检索（轻、零额外依赖）；后续可选加 embeddings 语义检索。
4. **自动标签/摘要**：一键为当前笔记生成 frontmatter `tags` + 摘要并写回文件头。

### UI/UX

- 右栏新增「AI」tab（与 反链/大纲/属性 并列）：助手对话 + RAG 问答 + 快捷动作按钮。
- 编辑器选中文本 → 浮起迷你工具条（扩写/润色/翻译/…）。
- 设置区：AI 接入（baseUrl/key/model + 测试连接）。
- 流式打字动画、可中断、来源引用卡片。

## 3. 待你确认（实施前）

1. **接入**：按 **Responses API** + 你提供 base URL / API key / 模型名 —— ✅?
2. **优先级**：先做「写作辅助 + AI 双链建议」，再「RAG 问答」，最后「自动标签/摘要」—— ✅? 还是调整顺序?
3. **RAG 深度**：MVP 先用**词法检索**（轻）；语义向量（embeddings，重）以后再加 —— ✅?
4. 密钥存本机 settings、走梯子出网 —— ✅?
