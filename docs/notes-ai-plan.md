# Notes AI 早期方案（历史归档）

> 本文保留 Notes AI 的设计来源和当前边界，不再是“待确认后实施”的任务单。功能已进入 1.0.9 候选；模型可用性、弃用状态和价格以供应商当前官方文档为准。

## 当前实现

### 用户功能

- **写作辅助**：总结、续写、扩写、润色、起标题和翻译当前笔记；
- **内联编辑**：对选中文本或光标位置给出指令，流式生成后查看 diff，再选择保留、插入、放弃或重试；
- **双链建议**：结合当前笔记和库内标题推荐已有笔记，用户确认后插入 `[[双链]]`；
- **知识库问答**：使用现有本地词法索引查找相关片段，再把有限上下文交给模型回答；
- **标签**：生成候选标签，用户确认后合并到当前笔记 frontmatter。

当前 RAG 是轻量词法检索，不包含 embeddings、远端向量库或自动上传整个知识库。未来如增加语义检索，必须单独定义索引存储、上传范围、删除和隐私合同。

### 实现 owner

- `src/renderer-next/src/components/panels/notes/AiAssistant.tsx`：右栏快捷动作、问答、结果应用与停止；
- `src/renderer-next/src/components/panels/notes/InlineAiEdit.tsx`：选区入口、指令、diff 和写回；
- `src/renderer-next/src/lib/notes/aiClient.ts`：按 stream ID 与 Principal generation 过滤流式事件；
- `src/renderer-next/src/store/useNotesAiStore.ts`：Principal 作用域内的 provider 配置；
- `src/main/notesAi.js`：Responses 兼容请求、SSE 解析、有限重试、取消与终态收口。

Notes AI 与翻译中的 AI provider 复用同一个 `settings.translation.ai` 配置，避免两份 base URL、API Key、model 和 reasoning effort 漂移。设置写入带 revision、Principal ID 和 generation；账号或工作区切换会取消旧请求，迟到事件不能更新当前界面。

## API 合同

- 主进程向配置的 `/v1/responses` 端点发送 `model`、`instructions`、`input`、`stream: true` 和 `store: false`。
- 流式解析 `response.output_text.delta`，以 `response.completed` 收口；失败、取消和上游繁忙各有单一终态。
- 只有在尚未输出内容且错误属于限流或临时服务故障时才有限重试，避免重复半段回答。
- renderer 只接收与当前 stream、Principal ID 和 generation 匹配的事件。
- API Key 保存在当前 Principal 的本地设置作用域中，不上传协作服务端；切换个人/组织工作区不会复用另一侧配置。

模型 ID 不是产品常量。OpenAI 的 [模型目录](https://developers.openai.com/api/docs/models) 会持续演进；早期调研使用过的 [GPT-5-Codex 模型页](https://developers.openai.com/api/docs/models/gpt-5-codex) 说明该别名使用 Responses API，且当前已标记为 deprecated。代码和文档不应把它当作永久推荐，也不应凭历史快照推断当前价格或可用性。

## 安全与隐私边界

- Notes AI 只发送用户主动触发操作所需的文本和有限上下文，不在后台自动上传整个知识库。
- 用户在应用结果前可以查看输出；内联编辑提供 diff，写回后仍可使用编辑器撤销。
- API URL 只能使用 HTTP(S)，并经过与其它 AI 请求一致的端点解析和危险地址保护。远程 HTTP 会暴露明文内容和密钥，只应在用户理解警告后使用。
- 切换 Principal、退出登录、权限变化、组件卸载或用户点击停止时，旧请求必须取消并静默丢弃迟到事件。
- Notes AI 配置和运行状态属于当前 Principal；清理或切换浏览器分区不会删除笔记或 Notes AI 设置。

## 设计来源

早期交互参考了以下开源项目的产品思路，但没有复制其代码或插件运行时：

- [Obsidian Copilot](https://github.com/logancyang/obsidian-copilot)：知识库问答和来源上下文；
- [Text Generator](https://github.com/nhaouari/obsidian-textgenerator-plugin)：选中文本与模板化写作动作。

ShareGPT 复用自己的 MiniSearch 索引、笔记写回、Principal 生命周期和受限 preload API，不引入第二套插件状态或持久化 owner。

## 维护验证

Notes AI 改动至少覆盖：

- SSE delta/done/error、取消、有限重试和单一终态；
- Principal A/B/A 配置恢复、generation 切换和迟到事件隔离；
- 空配置、HTTP/HTTPS、危险地址和错误响应；
- 选区 diff、插入/替换/放弃、标签合并、双链建议和词法 RAG 上下文上限；
- 知识库内容不会在用户未触发时发送。
