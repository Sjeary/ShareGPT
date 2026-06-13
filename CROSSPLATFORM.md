# 跨平台（Windows / macOS）与跨版本适配清单 · 待确认

> 目的：新 UI（renderer-next）要像旧 4.2.0 一样**同时支持 Win 和 Mac**，且**每次升级都要兼顾双端**。
> 本文档列出所有需要差异化处理的点 + 现状 + 建议方案 + 优先级，**请你确认后我再实现**。
> 审计基于当前 `feature/ui-rebuild` 分支（2026-06-13）。

---

## A. Windows / macOS 平台差异

### A1. 窗口控制按钮（你点名的那个）· 🔴 必改
- **差异**：Windows 在**右上**用「— ▢ ✕」按钮；macOS 在**左上**用系统原生「红绿灯」（traffic lights，由系统画）。
- **现状**：主进程已正确分流——`titleBarStyle: darwin ? "hiddenInset" : "hidden"` + Mac 上 `setWindowButtonVisibility(true)`（即 Mac 显示原生红绿灯）。**但新 UI 的 `Titlebar.tsx` 不分平台，永远渲染 Windows 式「— ▢ ✕」按钮** → 在 Mac 上会和左上的原生红绿灯**重复**。
- **建议**：`Titlebar`/`WindowControls`/profile 窗口控制 读 `api.platform`，**macOS 时不渲染自定义按钮**（交给原生红绿灯），并给标题栏**左侧留白 ~78px**（避免品牌图标压在红绿灯下，对齐旧 `body[data-platform="darwin"] .topbar { padding-left: 84px }`）。
- 同样适用于：**个人资料独立窗口**的窗口控制。

### A2. 红绿灯垂直对齐自定义标题栏 · 🟡 建议
- **差异**：标题栏高度 44px（`h-11`），macOS `hiddenInset` 红绿灯默认位置可能和 44px 不居中。
- **建议**：`BrowserWindow` 加 `trafficLightPosition: { x: 16, y: 14 }`（按 44px 微调）让红绿灯纵向居中。

### A3. 应用菜单 / 输入框快捷键 · 🔴 必改（Mac 致命）
- **差异**：macOS 下若**没有应用菜单**，文本框里 **Cmd+C/V/X/A（复制/粘贴/剪切/全选）默认失效**（这是 Electron Mac 经典坑）。Windows 不受影响。
- **现状**：主进程对两端都 `removeMenu()`。Mac 上这会导致登录/聊天输入框**无法粘贴**等。
- **建议**：macOS 时 `Menu.setApplicationMenu` 设一份**最小菜单**（含 Edit 菜单的 `cut/copy/paste/selectAll/undo/redo` role + `Cmd+Q` 退出 + `Cmd+W` 关窗）；Windows 维持 `removeMenu()`。

### A4. 字体栈 · 🟡 建议
- **差异**：现 `--font-sans: 'Segoe UI Variable Text','Microsoft YaHei UI',system-ui` 偏 Windows。
- **建议**：加 Mac 字体：`-apple-system, 'SF Pro Text', 'PingFang SC'` 放前面，按平台优雅回退。

### A5. 最大化 vs 缩放（Zoom）语义 · 🟢 知悉即可
- **差异**：Win 绿/方块=最大化；Mac 绿灯=Zoom（贴合内容，非全屏）。
- **现状**：Mac 走原生红绿灯，行为天然正确（A1 改完后自定义最大化按钮在 Mac 不显示）。无需额外处理。

### A6. 沉浸全屏（GPT 网页那个）与红绿灯 · 🟡 复核
- **现状**：沉浸模式隐藏侧栏+面板头，**保留标题栏** → Mac 上红绿灯仍在标题栏，可正常退出。
- **建议**：复核 Mac 下沉浸态红绿灯仍可见可点；若以后做「连标题栏也隐藏」的完全沉浸，Mac 需另外安置红绿灯或保留一条窄拖拽条。

### A7. 滚动条 · 🟢 可选
- **差异**：Mac 原生是 overlay 细滚动条（自动隐藏），Win 是实体滚动条。
- **现状**：自定义 `::-webkit-scrollbar` 两端统一。
- **建议**：保持统一即可；若想更「原生」，Mac 可不覆盖让其用 overlay。优先级最低。

### A8. 打包：Mac 构建必须先 build:next · 🔴 必改（否则 Mac 包是旧 UI）
- **现状**：`dist:win*` 脚本已前置 `build:next`（构建新 UI 产物）；但 **`dist:mac` / `dist:mac:sender` / `dist:mac:sender:dmg` 没有** → 直接打 Mac 包会**用不到新 UI 的 dist**（回退旧 UI 或缺产物）。
- **建议**：给所有 `dist:mac*` 脚本同样前置 `npm run build:next &&`；`build.sender.json` 的 `files` 排除（renderer-next 的 node_modules/源码）对 mac target 同样生效（同一份 files），已 OK。

### A9. Mac 代码签名 / 公证（分发用）· 🟡 看你需求
- **差异**：未签名的 Mac 应用首次打开会被 Gatekeeper 拦（「已损坏/无法验证」），需右键打开或签名+公证。
- **现状**：未配置签名。`build.sender.json` mac target 为 `zip`/`dmg`。
- **建议**：自用/内部分发可不签（教用户右键打开）；要正式分发需 Apple 开发者证书做 codesign + notarize。**这点等你定是否需要。**

### A10. 自更新安装流程（dmg vs exe）· 🟡 复核
- **差异**：Win 下载 exe 直接替换；Mac 下载 dmg/zip 需解压挂载替换 .app。
- **现状**：bootstrap 已分 `windows`/`macos` 两套下载地址；新 UI 的「应用更新」按 `api.platform` 取对应平台的包（`bootstrap.ts` 已做 darwin→macos 映射）。主进程 `downloadAppUpdate/openAppUpdate` 的 Mac 安装路径需**实测复核**。
- **建议**：Mac 真机走一遍「检查更新→下载→安装」确认无误。

### A11. 键盘快捷键 · 🟢 预防
- **差异**：Mac 用 Cmd，Win 用 Ctrl。
- **现状**：新 UI 自定义快捷键很少（Esc 退沉浸、Enter 发送，两端一致）。
- **建议**：以后加全局快捷键统一用 `CmdOrCtrl`。

---

## B. 跨版本升级的「状态保留」（你刚问的 GPT 登录保留）

### B1. 内嵌 GPT / Gemini 登录态 · ✅ 已天然保留
- **机制**：webview 用**持久化 session 分区** `persist:gpt-chat` / `persist:gemini-chat`，cookie/登录存在 `userData/Partitions/` 下（Win: `%APPDATA%\ShareGPT`；Mac: `~/Library/Application Support/ShareGPT`），**和 exe 分离**。
- **为何升级能保留**：① 分区名新旧版一致；② userData 目录固定为 `ShareGPT`（`app.setName("ShareGPT")` + `applyStableUserDataPath`）；③ 升级只换 exe，不动 userData。所以**换版本后 GPT 登录自动还在**。
- **⚠️ 必须守住的约束（写进规范，以后别破坏）**：
  1. **不要改 webview 分区名**（`persist:gpt-chat` / `persist:gemini-chat`）。
  2. **不要改 app 名 / userData 目录**（始终 `ShareGPT`）。
  3. Mac 与 Win 各自的 userData 路径不同但都固定，互不影响。
- 一旦改了上面任一项，老用户的 GPT 登录会丢。

### B2. 设置 / 聊天记录 / 个人资料 · ✅ 已保留
- `settings.json` / `chat_history.json` 等都在 userData 下，升级不动 → 保留。聊天记录还会从协作服务器同步。

### B3. 升级备份快照 · ✅ 已有
- 旧主进程 `createUpdateBackup` 在更新时对关键数据做快照备份，新 UI 沿用。

### B4. 旧版(4.2.0)→ 新 UI 版 平滑升级 · ✅
- 新 UI 包用**同一个** userData 目录 + 同一组分区名 → 从旧 4.2.0 升级到新 UI 版，GPT 登录、设置、聊天记录**全部保留**。

---

## C. 建议的落地顺序（待你确认）

| 优先级 | 项 | 说明 |
|---|---|---|
| 🔴 P0 | A1 窗口控制分平台 | Mac 用原生红绿灯+左侧留白，不画自定义按钮 |
| 🔴 P0 | A3 Mac 应用菜单 | 否则 Mac 输入框不能复制粘贴 |
| 🔴 P0 | A8 dist:mac 前置 build:next | 否则 Mac 包不含新 UI |
| 🟡 P1 | A2 红绿灯位置、A4 字体、A6 沉浸复核、A10 更新流程复核 | 体验/正确性 |
| 🟢 P2 | A7 滚动条、A11 快捷键预防 | 可选 |
| 🟡 待定 | A9 Mac 签名公证 | 看你是否要正式分发 |
| ✅ 已具备 | B1–B4 跨版本状态保留 | 已天然支持，只需守住 B1 约束 |

> 说明：我手头是 Windows 环境，A 部分的 Mac 真机表现（红绿灯位置、菜单、更新安装、签名）需要在 Mac 上最终验证。代码我可以按上面方案先实现，Mac 真机走查再微调。

---

**请你确认：** 上面 P0/P1 是否都要做？A9（Mac 签名）你要不要正式分发？确认后我按顺序实现。
