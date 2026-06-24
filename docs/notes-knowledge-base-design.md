# 知识库模块设计（Obsidian 核心自研 · 自用）

> 目标：在本应用内自研一个与 Obsidian 数据兼容的知识库模块，覆盖其全部核心：
> 双链/反链、本地纯文本 vault、嵌入转写、块引用、标签+属性、全文搜索+操作符、
> 日记+模板、大纲+文件夹树、**图谱视图（要的就是这个，不做思维导图）**、Canvas、Bases、
> 命令面板/快捷键/主题；外加本应用已有的**多端同步**与**AI 扩写**差异化。自用，不追求商用合规洁癖。
> 设计日期 2026-06-23。

## 0. 设计原则

- **本地优先 + 纯文本为真源**：笔记是磁盘上真实的 `.md` 文件夹（vault），可被 Obsidian 直接打开、随时拿走。app 只是这个 vault 的一个编辑器/视图层。
- **主进程拥有 vault**：所有 fs 读写、文件监听、链接索引、搜索索引都在 Electron 主进程（或其 worker），渲染层是纯 UI，经 IPC 通信（沿用现有 preload 契约链）。
- **索引派生、可重建**：链接图 / 反链 / 标签 / 搜索都是从 `.md` 派生的内存索引，任何时刻可全量重建；磁盘上只存 markdown（+ 一份可丢弃的缓存）。
- **与现有模块同构**：导航项、store、IPC、云同步都照 1.0.2 的日历/待办模块的既有范式接。

## 1. 架构总览

```
┌─────────────────────────── Renderer (React 19) ───────────────────────────┐
│  笔记面板 NotesPanel                                                        │
│   左: 文件树 + 标签树 + 搜索框      中: 编辑器(CM6)/阅读(remark)/图谱 切换    │
│   右: 反链 + 大纲 + 属性 + AI 助手   叠层: 命令面板 / 快速切换 / 图谱全屏      │
│  stores: useVaultStore  useNoteStore  useGraphStore  useNotesSyncStore      │
└───────────────▲───────────────────────────────────────────────┬───────────┘
        IPC (window.api.vault.* / index.* / ai.*)                │ 事件: 文件变更/索引更新
┌───────────────┴───────────────────────────────────────────────▼───────────┐
│  Main 进程：src/main/vault/                                                  │
│   fsStore(CRUD+原子写)  watcher(chokidar)  parser(remark: 链接/嵌入/标签/块)  │
│   linkIndex(出链/反链 邻接表)  searchIndex(MiniSearch)  templates/dailyNotes  │
│   notesSync(对接 collab server)  aiClient(走发送代理, 用户 token)             │
└───────────────▲───────────────────────────────────────────────┬───────────┘
                │ HTTPS + 复用聊天 WS (wsBus)                      │ fs
┌───────────────┴──────────────┐                    ┌────────────▼────────────┐
│ Collab server (3 群)          │                    │  Vault 文件夹 (.md/.canvas │
│  P1: user-store kind=notes    │                    │  /附件)  ——本地真源        │
│  P2: /api/notes/* 逐文件 rev   │                    └─────────────────────────┘
└──────────────────────────────┘
```

## 2. 存储模型（决策：真 vault 文件夹）

- 默认 vault 路径：`{userData}/vault/`；设置里可改为**任意文件夹**（含直接指向已有的 Obsidian vault）。
- 目录结构即文件夹树；`.md` 为笔记；附件放 `attachments/`；`.canvas`=白板；`.base`=Bases 视图；`.obsidian/` 若存在则只读其部分配置（不写）。
- app 私有缓存（可删）：`{userData}/vault-cache/{vaultId}/index.json`（链接/搜索索引快照，加速冷启动；丢了能重建）。
- **不再把笔记塞进 tasks.json**；笔记是独立子系统。日历/待办保持原样。

## 3. 数据模型（TS）

```ts
// 一篇笔记（内存态；磁盘是 .md）
interface Note {
  id: string; // = vault 内相对路径（稳定、唯一），如 "项目/A.md"
  path: string; // 同 id
  title: string; // frontmatter.title ?? 首个 H1 ?? 文件名
  frontmatter: Record<string, unknown>; // YAML 属性
  tags: string[]; // frontmatter.tags ∪ 正文 #tag（含嵌套 a/b）
  body: string; // 去掉 frontmatter 的 markdown 原文
  outline: HeadingNode[]; // 标题树（大纲/导航）
  blocks: BlockRef[]; // 带 ^id 的块（用于块引用/嵌入）
  links: LinkRef[]; // 出链（已解析 + 未解析）
  mtime: number;
  ctime: number;
  rev: number; // rev 用于同步
}
interface LinkRef {
  raw: string; // 原始 "[[A#标题|别名]]" / "![[A#^blk]]"
  targetPath: string | null; // 解析到的目标(最短唯一路径)；null=未解析
  subpath?: string; // #标题 或 #^块id
  alias?: string;
  embed: boolean; // ![[ ]] => embed=true
}
interface BlockRef {
  id: string;
  line: number;
  text: string;
}
interface HeadingNode {
  level: number;
  text: string;
  line: number;
  children: HeadingNode[];
}

// 链接索引（全库，内存，增量维护）
interface LinkIndex {
  out: Map<string, LinkRef[]>; // path -> 出链
  back: Map<string, BacklinkHit[]>; // path -> 反链命中（含来源行上下文）
  tags: Map<string, Set<string>>; // tag -> 含该 tag 的 path 集
  unresolved: Map<string, string[]>; // 未解析链接文本 -> 引用它的 path（可一键建空笔记）
}
interface BacklinkHit {
  fromPath: string;
  line: number;
  context: string;
  subpath?: string;
}

// Canvas（JSON Canvas v1.0 开放规范，直接存为 .canvas）
interface CanvasDoc {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
} // 字段照 jsoncanvas.org/spec/1.0
```

## 4. 后端核心（主进程 `src/main/vault/`）

| 子模块                     | 职责                                                                    | 库                                                                              |
| -------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `fsStore`                  | 列目录/读/写(原子 tmp+rename)/重命名/删除/移动；附件复制                | node:fs                                                                         |
| `watcher`                  | 监听 vault 外部改动（含 Obsidian 同时在编辑）→ 触发增量重解析           | `chokidar`                                                                      |
| `parser`                   | 解析单篇：frontmatter / `[[ ]]` / `![[ ]]` / `#tag` / `^block` / 标题树 | `gray-matter` + `unified/remark` + `remark-gfm` + 自写 wiki-link micromark 扩展 |
| `linkIndex`                | 维护 out/back/tags/unresolved；单文件变更只重算受影响项                 | 纯 JS                                                                           |
| `searchIndex`              | 全文索引 + 操作符 `tag: path: line: file:`；增量更新                    | `MiniSearch`（或 `Orama`）                                                      |
| `resolver`                 | `[[文本]]` → 目标文件（Obsidian「最短唯一路径」规则）                   | 纯 JS                                                                           |
| `templates` / `dailyNotes` | 模板变量替换；按日期模板生成/打开今日笔记                               | `date-fns`（已在用）                                                            |
| `notesSync`                | 与 collab server 同步（见 §7），复用聊天 WS（wsBus）                    | —                                                                               |
| `aiClient`                 | 调用户配置的 LLM API，**走发送代理**（梯子），流式返回                  | fetch                                                                           |

**IPC 契约新增**（沿用 backend.js ↔ appFactory ipcMain.handle ↔ preload ↔ lib/api.ts ↔ types/api.d.ts 链）：

```
vault.openFolder()/getRoot()/setRoot(path)
vault.list()/read(path)/write(path,content)/create(path,tpl?)/rename(from,to)/remove(path)
vault.importObsidian(folderOrZip) -> 导入报告
index.search(query)/backlinks(path)/outline(path)/tags()/unresolved()/graph(scope)
ai.complete({mode, selection, noteCtx})  // 流式: onAiEvent 已有事件通道可复用
// 主→渲染 事件: onVaultChanged(path)/onIndexUpdated()
```

## 5. 前端 UI / UX

### 5a. 布局（三栏 + 叠层）

```
┌────────────┬──────────────────────────────────────┬──────────────┐
│ 侧栏(左)    │  主区(中) —— 顶部标签页: 编辑/阅读/图谱  │  侧栏(右)     │
│ ┌────────┐ │ ┌──────────────────────────────────┐ │ ┌──────────┐ │
│ │搜索框   │ │ │  CodeMirror6 (Live Preview)       │ │ │反链      │ │
│ ├────────┤ │ │  · [[ ]] 高亮+点击跳转+自动补全     │ │ │(来源+上下文)│ │
│ │文件树   │ │ │  · ![[ ]] 内联嵌入渲染            │ │ ├──────────┤ │
│ │folders  │ │ │  · #tag / 属性 / callout 渲染     │ │ │大纲(标题树)│ │
│ ├────────┤ │ │                                  │ │ ├──────────┤ │
│ │标签树   │ │ │  阅读模式 = remark 渲染            │ │ │属性(YAML) │ │
│ │#tags    │ │ │  图谱模式 = force-graph(局部/全局) │ │ ├──────────┤ │
│ └────────┘ │ └──────────────────────────────────┘ │ │AI 助手    │ │
└────────────┴──────────────────────────────────────┴──────────────┘
 叠层: ⌘P 命令面板 | ⌘O 快速切换笔记 | 图谱全屏 | 设置(vault路径/同步/AI/主题)
```

- 左右栏可折叠（沿用现有侧栏可滚动/折叠的实现）。字体/间距对齐 1.0.2 已放大的风格。

### 5b. 图谱视图（重点）

- **局部图谱**：以当前笔记为中心，展开 N 度邻居（双链相连）；右侧栏内嵌小图 + 可全屏。
- **全局图谱**：整库力导向网络；节点=笔记、连线=`[[链接]]`；大小=反链数；颜色=文件夹/标签。
- 交互：悬停高亮邻居、点击打开笔记、按标签/文件夹/时间过滤、孤立笔记(无链接)高亮。
- 库：`react-force-graph`（2D 默认，可选 3D）；数据来自 `index.graph(scope)`；万级节点做节点上限+聚类+懒加载。

### 5c. 编辑器

- `CodeMirror 6` + `@codemirror/lang-markdown` + 自写装饰层做 Live Preview（`[[ ]]`/`![[ ]]`/`#tag`/callout/属性即写即显）。
- `[[` 触发**双链自动补全**（拉 `index` 的标题/别名/路径）；`Ctrl+点击` 跳转；未解析链接以虚线样式 + 一键建笔记。
- 阅读模式用 `react-markdown`+remark 插件渲染（嵌入 `![[ ]]` 内联展开、块引用定位）。

### 5d. 组件/状态

- 面板：`components/panels/notes/{NotesPanel, FileTree, TagTree, SearchBox, NoteEditor, NoteReader, GraphView, BacklinksPanel, OutlinePanel, PropertiesPanel, AiAssistant, CommandPalette, QuickSwitcher, CanvasView, BaseView}`
- store：`useVaultStore`(树/当前笔记/打开标签)、`useNoteStore`(当前笔记内容/脏标记/保存)、`useGraphStore`(图数据/过滤)、`useNotesSyncStore`(同步状态)、`useNotesSettingsStore`(vault 路径/AI/主题)。
- 命令面板 `cmdk`；快捷键集中注册（⌘P/⌘O/⌘F/新建/今日笔记…）。

## 6. AI 模块（你的差异化）

- Provider 抽象：OpenAI 兼容 / Claude / 自定义 base_url + key（用户自己的 token），**请求走发送代理（梯子）**，复用现有 `ai.*` 事件通道做流式。
- 功能：**扩写 / 续写 / 总结 / 润色 / 改写 / 生成标题 / 翻译**（选中文本或整篇）；并提供 **AI 双链建议**（读当前笔记 → 推荐应链接的已有笔记，回填到图谱，弥补"手动连接"的成本）。
- UI：右栏 AI 助手 + 选中文字浮起工具条；结果可"替换/插入/追加/丢弃"。

## 7. 多端同步（简化：单会话顺序同步，拉取时与本地对比）

**前提**：一台电脑同一时刻只登录一个账号，**不存在两端同时在线** → **不需要实时推送**。
模型 = 写完推送到云；换端打开时拉取并与本地对比合并（git pull/push 的简化版，无实时层）。

- **传输**：复用现成 user-store，新增 kind=`notes`，**整库作为一个带 rev 的 blob**。服务端改动**仅一行**：`USER_STORE_KINDS` 加 `"notes"`（按既有 graft 流程部署 3 群）。PUT 体上限 8MB，纯 markdown 足够数千篇；超大库再降级为「按改动文件增量」。**笔记同步不接 WS**（无实时需求）。
- **每端本地多存两样**（作三方合并的公共祖先）：`baseSnapshot`=上次成功同步时的整库快照；`baseRev`=当时云端 rev。

**推送（保存防抖 / 关闭时）**：以 `baseRev` 作 PUT。

- 200 → 更新 `baseSnapshot`/`baseRev`，完成。
- 409（云端已在别端推过、领先）→ 先执行下面的「拉取合并」，再重推。

**拉取并对比（打开 / 登录 / 手动「同步」）**：GET 云端 blob 得 `cloudVault`+`cloudRev`。

- `cloudRev == baseRev`：云端无新内容（本地若有改动，稍后推送即可）。
- `cloudRev > baseRev`：逐文件**三方合并**（base=`baseSnapshot`, ours=本地, theirs=云端）：
  - 仅云端改 → 取云端；仅本地改 → 留本地；两端同改且结果一致 → 无冲突；
  - 两端都改且不同 → 先按行 diff3 自动合并，合得上就合；合不上则**保留双方**：本地留 ours，另写 `原名 (云端冲突副本).md` 存 theirs，并标记（与 Obsidian Sync 行为一致）；
  - 一端删、一端改 → 视为冲突，不静默丢弃。
  - 合并结果落盘 → `baseSnapshot`=合并结果 → 重推得新 rev → `baseRev`=新 rev。

**「和本地对比」UI**：拉取后若有差异，弹**同步对比面板**（轻量 git-diff 风格）：逐文件状态（云端更新 / 本地更新 / 冲突）+ 差异预览；可选「自动合并无冲突项、仅冲突让我确认」或「全部我来逐条选」。

> 因为没有实时、单会话，409 与冲突只在**换端**时偶发，绝大多数是干净的快进合并。`watcher` 捕获的外部（你同时开 Obsidian）改动也纳入同一套 base/合并，避免本地与他端互踩。

## 8. 与现有 app 的接入点

- 左侧导航加一项「笔记/知识库」（照日历/待办那样加 NavKey + 面板路由）。
- 主进程：新增 `src/main/vault/` 模块，在 `backend.js` 实例化、`appFactory.js` 注册 `ipcMain.handle`。
- 渲染层：`api.ts`/`types/api.d.ts` 加 `vault/index/ai` 契约；新面板与 store 如上。
- 同步：`lib/cloudSync.ts` 加 `notes` 的 KindConfig；`useCloudSync` 的 KINDS 加 `notes`；复用 `wsBus`。
- 导入：照 `lib/ics.ts` 的「解析→规范化→入库」范式做 vault 导入（§见调研文档 obsidian-integration-research.md）。

## 9. 分阶段路线

- **P1 知识库内核**：vault 真源 + .md CRUD + CM6 编辑/阅读 + `[[双链]]`+自动补全 + 反链面板 + `#标签`/属性 + 大纲 + 文件树 + MiniSearch 全文搜索(操作符) + vault/Obsidian 导入导出 + 云同步(notes blob)。→ "知识库很好"的 ~80%。
- **P2 图谱 + AI**：全局/局部**图谱视图** + AI 扩写/续写/总结/双链建议 + 命令面板/快速切换/快捷键 + 日记/模板。
- **P3 进阶**：嵌入 `![[ ]]` 内联 + 块引用 `^id` + 主题/CSS +（大库可选）按改动文件增量同步。
- **P4 可选**：Canvas（JSON Canvas，react-flow）+ Bases（YAML→表格/看板）。

## 10. 风险与取舍

1. **同步合并的正确性** —— 因单会话/无实时已大幅降难，但三方合并（干净快进 / 双改自动合 / 冲突副本 / 删改冲突）仍需单测护栏；整库 blob 8MB 上限下超大库要降级为按改动文件增量。
2. **CM6 Live Preview** —— 所见即所得装饰层有工程量；先做"源码编辑 + 阅读预览"双模式，再逼近 Live Preview。
3. **外部编辑并发**（你同时开 Obsidian）—— watcher + rev 要稳，否则互相覆盖。
4. **索引性能** —— 万级笔记需增量索引 + 冷启动用缓存快照 + 图谱节点上限。
5. **Canvas/Bases 保真** —— 只做开放格式的子集，复杂特性不强求与 Obsidian 逐字节一致。
6. **块引用/嵌入边界** —— 跨文件块定位、循环嵌入需防护。

```

```
