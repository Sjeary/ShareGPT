# Obsidian 集成可行性调研

> 目标：评估能否把 Obsidian 的「功能核心」集成进本应用的笔记模块（当前的备忘/便签），
> 给出完整的集成逻辑与流程，并客观列出做不到的地方。结论先行见文末「总结与建议」。
> 调研日期 2026-06-23。

## 1. 调研方法

1. **拆解 Obsidian 核心**：区分「数据格式（开放）」与「应用本体/插件生态（封闭）」两层 —— 这是判断能否集成的关键分水岭。
2. **外部事实核验**（Web）：许可证/技术栈（Wikipedia）、Markdown 扩展语法与 Canvas/Bases 格式、编辑器引擎（CodeMirror 6）、JSON Canvas 开放规范。来源见文末。
3. **本仓库现状审计**（代码）：现有 Memo/Task 数据模型、持久化、云同步、导入范式（.ics）、技术栈 —— 判断「适配当前笔记」的改造面与复用点。
4. **逐特性裁决**：对每个核心能力给出 可做 / 部分 / 不可做 + 理由 + 所需开源库。
5. **产出**：数据模型、导入/反向导出流程、分阶段落地计划、风险与不足。

## 2. Obsidian 核心拆解（两层）

### 2a. 数据层 —— **完全开放，可无损互通**

- **Vault = 一个普通文件夹**，里面是 `.md` 文本文件 + 一个 `.obsidian/` 配置目录。没有数据库、无锁定。
- **Markdown**：CommonMark + GFM，外加 Obsidian 扩展：
  - 双链 `[[笔记名]]`、别名 `[[笔记名|显示文本]]`、指向标题 `[[笔记#标题]]`、指向块 `[[笔记#^块id]]`
  - 嵌入/转写 `![[笔记]]`、`![[图片.png|300]]`、`![[文档.pdf#page=3]]`
  - 标签 `#tag`（含嵌套 `#a/b`）
  - 标注框 callout `> [!note]`
  - **Properties/前言**：文件头 YAML frontmatter（`tags`/`aliases`/`cssclasses` + 任意自定义字段）
- **Canvas `.canvas`** = **JSON Canvas**，已于 2024 拆成**独立的开放规范（MIT，v1.0，jsoncanvas.org）**，任何应用可自由 导入/导出/存储。
- **Bases `.base`**（2026 新增核心插件）= YAML 描述的「把 vault 当数据库」的视图。

> 含义：**导入/导出 100% 可实现且无损**，甚至可以直接指向用户已有的 Obsidian vault。"知识库很好" 的根基（开放 markdown + 双链）正是最容易拿过来的部分。

### 2b. 应用层 —— **封闭，不能搬**

- Obsidian 是**专有/闭源**软件（个人与商用均免费，但**不开源**；付费的是 Sync/Publish 云服务与商用授权）。技术上是 Electron + **CodeMirror 6**（Live Preview）。
- **社区插件生态（2000+）绑定 Obsidian 私有 App API 与其 Electron 运行时** —— 无法在外部应用加载。Dataview、Templater、Excalidraw 等都依赖这套私有运行时。

> 含义：**"把 Obsidian 整个/连同插件生态集成进来" 在工程上不可行**。可行的是「用开放格式 + 开源库，自建一个与 Obsidian 数据兼容的笔记模块」。下文所有"集成"均指后者。

## 3. 本应用现状（改造基线）

| 维度           | 现状                                                                                                 | 出处                                       |
| -------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 笔记模型       | `Memo { id,title?,body,color,pinned,tags?,createdAt,updatedAt }`，`body` **纯文本**                  | `store/useTasksStore.ts`                   |
| 渲染           | 纯文本 `whitespace-pre-wrap`，**无任何 markdown 库**（package.json 无 react-markdown/marked/remark） | `panels/todo/MemoCard.tsx`                 |
| 编辑           | 原生 `<textarea>`，无工具栏/预览                                                                     | `panels/todo/MemoEditor.tsx`               |
| 持久化         | **单个 JSON blob** `{userData}/tasks.json`（lists+tasks+memos 一起），300ms debounce 落盘            | `main/backend.js`                          |
| 云同步         | rev 版本号乐观并发，kind=`calendar`/`tasks`；复用聊天 WS 实时；按 id `updatedAt` 取新者合并          | `lib/cloudSync.ts`/`hooks/useCloudSync.ts` |
| 双链/反链/图谱 | **完全没有**（grep `[[`/wikilink/backlink 零命中）                                                   | —                                          |
| 关联           | 仅 任务↔日历（`task.calendarEventId`）                                                               | `lib/integrations.ts`                      |
| 导入范式       | `.ics`：解析外部格式→规范化→`importEvents()` 落库（可直接套用到 .md）                                | `lib/ics.ts`                               |
| 搜索           | 仅备忘的子串过滤（title/body/tags），无全文索引                                                      | `panels/todo/MemoBoard.tsx`                |
| 技术栈         | React 19 + Tailwind 4 + Radix/shadcn；无代码编辑器组件                                               | `package.json`                             |

**关键缺口**：纯文本（无 markdown）、单 blob 存储（非 file-per-note）、无链接图、无全文索引。

## 4. 逐特性可行性裁决

✅可做（开源库齐全） ⚠️部分/有成本 ❌不可做

| Obsidian 能力                       | 裁决           | 实现方式 / 所需开源库                                                                                                  |
| ----------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Markdown 笔记（CommonMark+GFM）     | ✅             | `react-markdown` + `remark-gfm`                                                                                        |
| Live Preview 编辑                   | ✅             | CodeMirror 6（MIT，`@codemirror/lang-markdown` + 类似 `codemirror-live-markdown` 的所见即所得层）；或 Milkdown/Lexical |
| 双链 `[[ ]]` + 别名                 | ✅             | 自定义 remark/micromark 扩展（参考 `remark-wiki-link`）+ 链接索引                                                      |
| 指向标题/块 `#标题`/`#^块`          | ⚠️             | 解析可做；块级锚点与渲染定位需额外工作                                                                                 |
| 嵌入 `![[ ]]`（笔记/图片）          | ⚠️             | 笔记/图片易；PDF 分页嵌入成本高                                                                                        |
| 反链面板 Backlinks                  | ✅             | 由链接索引反向查询                                                                                                     |
| 标签 `#tag`（含嵌套）               | ✅             | 解析 + 标签树                                                                                                          |
| Properties / YAML 前言              | ✅             | `gray-matter` 解析；属性面板 UI                                                                                        |
| 图谱视图（局部+全局）               | ✅             | `react-force-graph`/`cytoscape`/`sigma.js`（万级节点需虚拟化与增量布局 ⚠️）                                            |
| Canvas 无限白板                     | ⚠️             | 数据用 **JSON Canvas 开放规范**；UI 自建（`react-flow`），完整还原成本大                                               |
| Bases 数据库视图（2026）            | ⚠️             | 可做表格/看板的查询视图；完整 Bases 查询语言是大工程                                                                   |
| 全文搜索                            | ✅基础         | `MiniSearch`/`Orama`/`Fuse.js`（前缀+模糊）；高级搜索操作符 ⚠️                                                         |
| 命令面板 / 快捷键                   | ✅             | 自建（cmdk 等）                                                                                                        |
| 主题 / CSS 片段                     | ⚠️             | 可支持自定义 CSS，但 Obsidian 主题不可直接套用                                                                         |
| **社区插件生态（2000+）**           | ❌             | 绑定 Obsidian 私有 API + 运行时，外部无法加载                                                                          |
| Obsidian Sync（E2E 加密、版本历史） | 用自有方案替代 | 已有 `/api/user-store` 服务端可承载；E2E 加密/版本史需另建 ⚠️                                                          |
| Obsidian Publish（公开站点）        | ❌/不适用      | 专有服务                                                                                                               |

## 5. 集成架构与数据模型

### 5a. 关键抉择：存储模型

- **方案 A —— Vault 原生（推荐为最终态）**：笔记落为磁盘上一个 vault 文件夹里的真实 `.md` 文件（主进程 fs 读写），保留目录结构。
  - 优点：导入/导出无损、零锁定、可直接打开用户现有 Obsidian vault。
  - 代价：是一次存储层改造；云同步需「逐文件 rev」或「整库打包同步」。
- **方案 B —— 适配器（最快上线）**：沿用现有 store，把 `Memo` 升级为 `Note`（markdown body + 解析出的链接/标签），导入时 `.md → Note`、导出时 `Note → .md`。
  - 优点：完全契合现有 tasks.json + user-store 同步，改动最小。
  - 代价：非真 vault，附件/Canvas/插件数据来回会有保真损失。
- **方案 C —— 混合（推荐落地路径）**：以 **app 管理的 vault 文件夹（.md 为准）** 作为本地真源（A 的存储），上层套本应用 UI；同步 MVP 先「整库 blob」，再演进到逐文件 rev。

### 5b. 建议数据模型（方案 C/B 通用）

```ts
interface Note {
  id: string; // 稳定 id（首次导入由相对路径派生）
  path: string; // vault 内相对路径，如 "项目/笔记.md"（目录即文件夹树）
  title: string; // 取自 frontmatter.title 或文件名/首个 H1
  body: string; // markdown 原文（不含 frontmatter）
  frontmatter: Record<string, unknown>; // YAML 属性
  tags: string[]; // 由 frontmatter.tags + 正文 #tag 归并
  links: string[]; // 出链（解析 [[ ]] 后解析到的目标 path/id）
  createdAt: string;
  updatedAt: string;
}
// 反链 = 全库扫描 links 的反向索引（内存，懒构建）
// 附件存 attachments/；Canvas 存为 JSON Canvas 文档
```

- **链接索引**：导入/编辑后构建 `Map<noteId, {out:Set, in:Set}>`，驱动反链面板与图谱。
- **链接解析**：照 Obsidian「最短唯一路径」规则把 `[[文本]]` 解析到具体文件；解析不到的记为「未解析链接」（可一键建空笔记）。

### 5c. 云同步

- 新增 kind=`notes`，复用现成 rev 乐观并发 + 聊天 WS 实时（与 calendar/tasks 同构）。
- MVP：整库 JSON（含所有 Note）作为一个 user-store blob —— 立刻可用，但大库笨重、合并粒度粗。
- 演进：**逐文件 rev**（每个 note 独立版本号）+ 三方合并 —— 真正多端无冲突，但这是本项目最难的一块（见不足）。

## 6. 导入流程（"方便导入" 的核心）

```
选择 vault 文件夹 / .zip（Electron dialog，主进程 fs）
  → 递归扫描 .md / .canvas / 附件(png,jpg,pdf...)，忽略 .obsidian/
  → 每个 .md：gray-matter 拆 frontmatter|body；相对路径→note id（保留文件夹树）
  → 解析正文 [[链接]] / ![[嵌入]] / #标签 → 建链接图
  → 按 Obsidian 最短唯一路径解析链接目标；解析不到→「未解析链接」清单
  → 附件复制进 attachments/，重写嵌入路径
  → .canvas 按 JSON Canvas 导入为画布文档
  → 落库（方案 C 写真 .md 文件 / 方案 B 写 store）；再次导入按相对路径去重
  → 展示导入报告：N 篇笔记、M 条链接已解析、K 条未解析、X 个附件
反向导出：Note → 带 frontmatter 的 .md 回写 → 往返无损、零锁定
```

- 现成范式可直接套用：`lib/ics.ts` 的「解析→规范化→importEvents」就是模板。
- 「方便」体现在：① 直接选 vault 文件夹一键全量；② 也支持拖入单个/多个 .md；③ 导入报告 + 未解析链接可视化。

## 7. 分阶段落地

- **P1 兼容笔记（2–3 周量级）**：`Memo→Note` 升级；CM6 + react-markdown 编辑/预览；`[[双链]]`+反链面板；`#标签`+frontmatter；MiniSearch 全文搜索；`.md`/vault 文件夹导入 + 导出；notes 接入云同步（整库 blob）。→ 已覆盖 Obsidian "知识库" 最核心的 80%。
- **P2 图谱与结构**：全局/局部图谱视图；目录/文件夹树；属性面板；标签树；命令面板。
- **P3 进阶**：Canvas（JSON Canvas 往返）；Bases 式表格/看板查询；嵌入 `![[ ]]`；逐文件 rev 同步。
- **明确不做**：Obsidian 插件生态、Publish、与 Obsidian Sync 的逐字节对齐。

## 8. 客观不足与风险

1. **不能集成插件生态（最大缺口）**：Obsidian 闭源、插件绑私有运行时。依赖 Dataview/Templater/Excalidraw 等的工作流要么自研、要么放弃。"完全集成 Obsidian" 不成立；能做到的是"数据兼容 + 核心体验对齐"。
2. **非逐字节兼容**：markdown 方言细节、块引用/转写、Bases 查询语言、Canvas 高级特性，初期难 100% 还原。
3. **多端同步成熟度**：大量小文件的逐文件冲突合并 + E2E 加密 + 版本历史，达不到 Obsidian Sync 的打磨度，需要可观投入（本项目最硬的一块）。
4. **存储层改造**：要发挥真 vault 价值需从「单 JSON blob」迁到「file-per-note」，有迁移与同步重构成本（方案 B 可回避但牺牲保真）。
5. **性能/体积**：CM6 + 图谱 + 搜索索引增加包体；万级笔记需虚拟化 + 增量索引。
6. **维护负担**：需跟随 Obsidian 演进的开放格式（Bases 2026 仍在变）。

## 9. 总结与建议

- **能不能"把 Obsidian 完全集成"？** ❌ 不能 —— 它闭源、插件生态绑私有运行时。
- **能不能"把它的知识库核心拿过来并适配当前笔记、方便导入"？** ✅ 能，而且根基好：数据格式全开放（markdown + 双链 + JSON Canvas MIT 规范），编辑器引擎 CM6 开源可用，导入/导出可无损。
- **建议**：走「**开放格式 + 开源库 自建 Obsidian 兼容笔记模块**」路线，按方案 C 以 vault 文件夹为真源，分 P1→P3 推进；P1 即可拿下知识库核心体验的绝大部分。
- **明确边界**：不追求插件生态/Publish/与 Sync 逐字节对齐。

---

### 来源

- [Obsidian (software) — Wikipedia](<https://en.wikipedia.org/wiki/Obsidian_(software)>)（许可证/技术栈/Sync·Publish）
- [JSON Canvas — 开放规范 v1.0（MIT）](https://jsoncanvas.org/spec/1.0/) / [Obsidian 公告](https://obsidian.md/blog/json-canvas/) / [obsidianmd/jsoncanvas](https://github.com/obsidianmd/jsoncanvas)
- [A Systematic Guide to Using Obsidian in 2026（Bases/PARA/图谱）](https://enersys.co.th/en/insights/obsidian-systematic-pkm-guide-2026)
- [Obsidian Markdown 语法（双链/嵌入/callout/frontmatter）](https://www.markdowntools.io/obsidian-cheat-sheet) / [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills/blob/main/skills/obsidian-markdown/SKILL.md)
- [内部链接与图谱视图 — obsidian-help/DeepWiki](https://deepwiki.com/obsidianmd/obsidian-help/4.2-internal-links-and-graph-view)
- [CodeMirror 6 稳定版（编辑器引擎）](https://news.ycombinator.com/item?id=31666186) / [codemirror-live-markdown](https://github.com/blueberrycongee/codemirror-live-markdown)
