# 知识库模块 · 落地实施文档

> 配套架构/UI 设计见 [`notes-knowledge-base-design.md`](./notes-knowledge-base-design.md)（本文件只讲“怎么落地”）。
> 最终决策：自研 Obsidian 核心、自用；真 vault(`.md`)；主进程拥有 vault；
> **同步 = 单会话顺序同步、无实时、整库 blob + 拉取时三方合并对比**；做图谱、不做思维导图；AI 扩写为差异化。
> 2026-06-23。

## 1. 新增依赖（全部 MIT，与本仓库 GPL-3.0 兼容）

**Renderer**

- `codemirror` + `@codemirror/{state,view,commands,language,search,autocomplete,lang-markdown}` —— 编辑器
- `react-markdown` + `remark-gfm` + `remark-frontmatter` —— 阅读模式渲染
- `mdast-util-wiki-link` / `micromark-extension-wiki-link`（或自写）—— 双链解析
- `react-force-graph-2d`(+`d3-force`) —— 图谱
- `minisearch` —— 全文搜索
- `gray-matter` —— frontmatter
- `cmdk` —— 命令面板
- `node-diff3` —— 三方合并
- `date-fns`（已有）—— 日记/模板日期

**Main**

- `chokidar` —— 文件监听
- `gray-matter` + `unified`/`remark-parse`/`mdast-util-from-markdown` —— 解析与索引（主进程侧）

> 体积控制：CodeMirror、force-graph 用动态 import 按需加载，避免拖慢主包。

## 2. 文件清单（新增 ✚ / 改动 ✎）

**主进程**

```
✚ src/main/vault/index.js       模块装配：持有 root、indices、watcher，导出方法给 backend
✚ src/main/vault/fsStore.js     列目录/读/写(tmp+rename 原子)/创建/重命名/删除/移动；附件复制
✚ src/main/vault/parser.js      单篇解析：frontmatter / [[ ]] / ![[ ]] / #tag / ^block / 标题树
✚ src/main/vault/resolver.js    [[文本]] → 目标文件（最短唯一路径规则）
✚ src/main/vault/linkIndex.js   out/back/tags/unresolved 邻接表；单文件变更增量重算
✚ src/main/vault/searchIndex.js MiniSearch 封装 + 操作符 tag:/path:/line:/file:
✚ src/main/vault/watcher.js     chokidar 监听外部改动 → 增量重解析 + 通知渲染
✚ src/main/vault/templates.js   模板变量替换 + 日记(按日期模板 创建/打开 今日笔记)
✚ src/main/vault/notesSync.js   同步引擎（§4），调 collab user-store kind=notes
✚ src/main/vault/aiClient.js    LLM 调用（走发送代理，流式）
✎ src/main/backend.js           实例化 vault、转发方法
✎ src/main/appFactory.js        ipcMain.handle 注册 vault.*/index.*/ai.*；窗口就绪后启动 watcher
✎ src/main/preload.js           暴露 window.api.vault/index/ai + onVaultChanged/onIndexUpdated
```

**渲染层**

```
✎ src/renderer-next/src/types/api.d.ts   +vault/index/ai 契约（§3）
✎ src/renderer-next/src/lib/api.ts        +封装
✚ src/renderer-next/src/lib/wikilink.ts   双链解析/目标解析（前端共享，做高亮/补全）
✚ src/renderer-next/src/lib/notesMerge.ts 整库三方合并（§4）
✚ store: useVaultStore / useNoteStore / useGraphStore / useNotesSyncStore / useNotesSettingsStore
✚ components/panels/notes/:
     NotesPanel(总布局) FileTree TagTree SearchBox
     NoteEditor(CM6) NoteReader(remark) GraphView(force-graph)
     BacklinksPanel OutlinePanel PropertiesPanel AiAssistant
     CommandPalette(cmdk) QuickSwitcher SyncCompareDialog(同步对比)
     [P4] CanvasView BaseView
✎ components/layout/Sidebar.tsx          +NavKey 'notes' 与图标
✎ 面板路由处                              +notes 分支
✎ src/renderer-next/src/hooks/useNotesSync.ts  打开/登录时拉取对比、保存时推送
```

**服务端**

```
✎ collab_server2/server.js + 线上 graft：USER_STORE_KINDS 由 {calendar,tasks} → 加 "notes"（1 行）
  按 collab-server-access 记录的 graft 流程部署到 3 群（8088/8089/8090）。无新端点。
```

## 3. IPC 契约（最终签名，加进 types/api.d.ts）

```ts
interface VaultApi {
  getRoot(): Promise<string>;
  setRoot(path: string): Promise<{ ok: boolean; count: number }>;
  pickFolder(): Promise<string | null>; // 系统选目录
  list(): Promise<NoteMeta[]>; // 全库轻量元信息(不含 body)
  read(path: string): Promise<NoteFile>; // 含 body+frontmatter
  write(path: string, content: string): Promise<{ rev: number }>;
  create(path: string, templateId?: string): Promise<NoteFile>;
  rename(from: string, to: string): Promise<void>; // 同步改写引用它的 [[ ]]
  remove(path: string): Promise<void>;
  importObsidian(src: string): Promise<ImportReport>; // 文件夹或 .zip
  exportAll(destDir: string): Promise<void>;
  openToday(): Promise<NoteFile>; // 日记
}
interface IndexApi {
  search(query: string): Promise<SearchHit[]>; // 支持 tag:/path:/line:/file:
  backlinks(path: string): Promise<BacklinkHit[]>;
  outline(path: string): Promise<HeadingNode[]>;
  tags(): Promise<{ tag: string; count: number }[]>;
  unresolved(): Promise<{ text: string; from: string[] }[]>;
  graph(
    scope: { mode: "global" } | { mode: "local"; path: string; depth: number },
  ): Promise<{ nodes: GraphNode[]; links: GraphLink[] }>;
}
interface AiApi {
  complete(req: {
    mode:
      | "expand"
      | "continue"
      | "summary"
      | "polish"
      | "rewrite"
      | "title"
      | "translate"
      | "linkSuggest";
    text: string;
    notePath?: string;
  }): Promise<{ streamId: string }>;
  // 流式结果复用现有 onAiEvent 通道；linkSuggest 返回推荐的已有笔记 path[]
  cancel(streamId: string): Promise<void>;
}
// 主→渲染事件（preload onXxx）：onVaultChanged(path) / onIndexUpdated() / onSyncStatus(s)
```

## 4. 同步引擎（`notesSync.js` + `notesMerge.ts` 伪代码）

```
// blob 结构（存进 user-store kind=notes 的 data）
Blob = { files: { [path]: { content: string, hash: string, deleted?: boolean } } }

// 本地持久化：baseSnapshot(Blob 的 files) 与 baseRev（localStorage/磁盘缓存）

async function push() {                       // 保存防抖 / 关闭时
  const ours = readLocalVault()               // {path: content}
  const r = await PUT('/api/user-store/notes', { baseRev, data: toBlob(ours) })
  if (r.ok) { baseSnapshot = ours; baseRev = r.rev }
  else if (r.conflict) { await pullAndMerge(); return push() }   // 退避后重推
}

async function pullAndMerge() {               // 打开 / 登录 / 手动同步
  const { rev: cloudRev, data: cloudBlob } = await GET('/api/user-store/notes')
  if (cloudRev === baseRev) return { changed: [] }    // 云端无新内容
  const ours = readLocalVault(), theirs = fromBlob(cloudBlob), base = baseSnapshot
  const { merged, report } = mergeVault(base, ours, theirs)     // 三方合并
  if (report.conflicts.length && settings.reviewConflicts)
      await showSyncCompareDialog(report)     // 让用户逐条确认；否则自动按策略
  writeLocalVault(merged); baseSnapshot = merged
  const r = await PUT('/api/user-store/notes', { baseRev: cloudRev, data: toBlob(merged) })
  baseRev = r.rev
  return report
}

function mergeVault(base, ours, theirs) {     // 逐文件
  for (path of union(keys(base,ours,theirs))) {
    const b=base[path], o=ours[path], t=theirs[path]
    if (o===t) keep(o)                                   // 一致
    else if (o===b) take(t)                              // 仅云端改 → 取云端
    else if (t===b) take(o)                              // 仅本地改 → 留本地
    else if (deleted(o)||deleted(t)) conflict('del-edit',path)   // 删改冲突
    else {                                               // 双改 → 行级 diff3
      const m = diff3(o, b, t)
      if (m.clean) take(m.result)
      else { take(o); writeExtra(`${path%.md} (云端冲突副本).md`, t); conflict('content',path) }
    }
  }
  return { merged, report:{ fromCloud, keptLocal, conflicts } }
}
```

- 单元测试覆盖：干净快进、仅一端改、双改可自动合、双改冲突→副本、删改冲突。

## 5. 里程碑与验收标准（Definition of Done）

**M1 知识库内核**

- 设置选 vault 文件夹（或默认 `{userData}/vault`），左侧出现「笔记」导航项。
- 文件树浏览；新建/重命名/删除 `.md`（重命名自动改写引用其的 `[[ ]]`）。
- CM6 编辑 + 阅读预览双模；`[[` 自动补全、`Ctrl+点击` 跳转、未解析链接虚线+一键建。
- 反链面板显示来源+上下文；大纲跟随标题；属性面板读写 frontmatter。
- `#标签` 树；全文搜索框（支持 `tag:`/`path:`）。
- 导入一个真实 Obsidian vault：报告 N 篇/解析 M 链/未解析 K；导出回 `.md` 往返无损。
- 验收：建 3 篇互相 `[[ ]]` 的笔记，反链/跳转/搜索全部正确；导入随机 vault 不崩、链接解析率 ≥ 预期。

**M2 同步**

- 服务端 `notes` kind 上线（3 群）。保存→推送；打开→拉取对比。
- 换端场景 E2E：A 端写 → 云 → B 端打开看到「同步对比」并合并；双改触发冲突副本。
- 验收：A 改文件 X、B 离线改文件 Y → B 上线后 X、Y 都在；A、B 同改 X 不同内容 → 出现 `X (云端冲突副本).md` 且不丢数据。

**M3 图谱 + AI + 效率**

- 全局/局部**图谱**：节点=笔记、连线=双链、点击打开、按标签/文件夹过滤、孤立点高亮。
- AI：选中文字浮条 扩写/续写/总结/润色/翻译（流式、走代理、用户 token）；**AI 双链建议**回填。
- 命令面板 ⌘P、快速切换 ⌘O、快捷键；日记「今日笔记」+ 模板。
- 验收：万级以内笔记图谱可交互不卡；AI 流式可中断；⌘O 秒开任意笔记。

**M4 进阶（可选）**

- 嵌入 `![[ ]]` 内联展开、块引用 `^id` 定位；自定义主题/CSS。
- Canvas（JSON Canvas 往返）；Bases（YAML→表格/看板子集）。

## 6. 测试计划

- 单测：parser（链接/嵌入/标签/块/frontmatter）、resolver（最短唯一路径）、mergeVault（§4 五种情形）、wikilink 解析。
- 集成：导入真实 vault E2E；换端同步 E2E（A→云→B 对比合并）。
- 性能：1k / 10k 笔记的冷启动索引时间、搜索延迟、图谱帧率；超 8MB blob 的降级路径。
- 回归：确保不影响日历/待办/聊天既有同步（共用 user-store / wsBus）。

## 7. 风险（已因“单会话/无实时”大幅降低）

1. 三方合并正确性 —— 单测护栏；冲突一律保留双方，绝不静默丢。
2. 外部并发（同时开 Obsidian）—— watcher + base 快照纳入同一合并。
3. CM6 Live Preview 工程量 —— 先“源码编辑 + 阅读预览”，再逼近所见即所得。
4. 索引性能 —— 增量索引 + 冷启动缓存 + 图谱节点上限。
5. blob 8MB 上限 —— 超大库降级为按改动文件增量同步（P3）。

## 7b. 参考实现（评估结论：借鉴思路，不直接采用）

- **vrtmrz/obsidian-livesync**（MIT，TS）：Obsidian 同步的标杆。CouchDB/对象存储/WebRTC，**实时 + 内容分块(chunk)去重 + 自动合并冲突 + E2E 加密**。强但**重**：需 CouchDB、是 Obsidian 插件、实时 CRDT 级机制——对我们"单会话/无实时/打开时对比"的需求**过度**。可借鉴：① 大库的**分块/去重**思路（对应我们 P3「按改动文件增量」）；② "能自动合的自动合、其余浮出来"的冲突 UX。
- **haierkeys/fast-note-sync-service**（Apache-2.0，Go）：自托管笔记同步**后端**，REST+WS、**逐文件 CRUD**、离线自动合并、**历史版本**、FS/S3/WebDAV 存储、配套 Obsidian 插件。和我们更接近，但它是**独立 Go 服务**——采用=多养一套后端栈（我们已有 Node collab server + user-store + 鉴权 + 3 群）。可借鉴：其**逐文件 REST API 形态 + 历史版本**思路，待我们做 P3 逐文件同步时移植进现有 Node 服务（而非另起 Go 服务）。
- **结论**：维持原方案（复用现有 user-store，P1 整库 blob、P3 逐文件），把这两者当**设计参考**；P3 的逐文件版本历史借鉴 fast-note-sync，大库分块借鉴 livesync。两者许可证(MIT/Apache-2.0)都与本仓库 GPL-3.0 兼容，可放心读码移植。

## 8. 落地顺序建议

先 **M1（纯本地知识库内核，不碰同步）** 跑通体验 → 再 **M2 同步** → 再 **M3 图谱/AI**。
每个里程碑都可独立交付、独立验收；M1 完成即已是“能用的 Obsidian 式知识库”。
