# ShareGPT 实施、验证与运维历史

> 更新日期：2026-07-31。本文是维护总账，记录已经落地的功能、实际验证证据、部署原则、构建经验和待办。
> 面向维护者；面向用户的版本变化以 [`CHANGELOG.md`](../CHANGELOG.md) 为准，逐次发布步骤以
> [`RELEASING.md`](RELEASING.md) 为准。

## 1. 当前状态

- Git 已发布代码基线：`main`，版本 `1.0.6`，基线提交 `de1e286`。仓库当前没有
  `v1.0.6` tag；在补建 tag 前，部署说明必须使用这个不可变提交，不能引用不存在的 tag。
- 已发布版本：`1.0.6`。
- `codex/chore-electron43-cross-platform` 分支承载一组 **1.0.7 候选改动**：macOS 强制保留
  原生平台，以及 Electron 从 `31.7.7` 升到 `43.1.0`。根 `package.json` 暂时仍写 `1.0.6`，
  因此不得把候选构建覆盖到已发布的 1.0.6 资产；发布前必须先升为 `1.0.7`，重建
  Mac/Windows 产物。
- 协作后端的新增隐私配置使用现有增量载荷；老客户端会忽略未知字段，不能为了新功能破坏
  `1.0.5` 及更早客户端的登录、聊天、配置和更新接口。
- 真实密码、SSH 私钥、Cookie、Token、付款资料、代理订阅和节点密钥不得进入本文、Git、
  Issue、Release notes 或截图；只保存在密码管理器、服务器权限文件或本机安全配置中。

## 2. 文档和证据的唯一入口

| 主题         | 主要文档/代码                                                          | 作用                                               |
| ------------ | ---------------------------------------------------------------------- | -------------------------------------------------- |
| 用户版本变化 | [`CHANGELOG.md`](../CHANGELOG.md)                                      | 1.0.0 至今的用户可见功能                           |
| 架构         | [`ARCHITECTURE.md`](ARCHITECTURE.md)                                   | 客户端、协作后端、管理端和代理链路                 |
| 自托管       | [`SELF_HOSTING.md`](SELF_HOSTING.md)                                   | HTTPS 后端、直接出口、FRP + 树莓派、节点分发和排错 |
| 浏览器隐私   | [`browser-privacy.md`](browser-privacy.md)                             | 清除范围、环境模式、表盘、资料环境和产品边界       |
| 发布与包体   | [`RELEASING.md`](RELEASING.md)                                         | 版本、CI、Windows 安装包/便携版、DMG、Release      |
| 主进程实现   | `src/main/browserPrivacy.js`、`browserFingerprint.js`、`appFactory.js` | 会话清理、环境覆盖、表盘采集和窗口生命周期         |
| 回归验证     | `src/main/test/*.test.js`、`scripts/verify-browser-privacy*.js`        | 单测、真实 Electron 清理验证和 UI 验证             |
| 本机私有运维 | `MAINTAINING.local.md`                                                 | 本机路径、未公开运维提醒和当前构建产物             |

## 3. 近期版本落地历史

### 3.1 1.0.4：安装与基础体验基线

- Windows NSIS 改为向导式安装，允许选择安装目录。
- 消息通知默认更安静，Emoji Kitchen 资源与新手引导完善。
- 这一版是本轮浏览器隐私功能开始前的稳定基线。

### 3.2 1.0.5：按服务清理与环境配置

已落地：

- ChatGPT、Gemini、Claude 使用独立持久化 Session，可逐个清理；没有“全部清除”。
- 清理前通过协作后端复核当前账号密码；密码只用于本次请求，不写设置和日志。
- 清理 Cookie、Filesystem、IndexedDB、LocalStorage、WebSQL、Service Worker、Cache Storage、
  HTTP 认证、网络缓存、代码缓存和 DNS 缓存。
- 支持 `system`、`us`、`proxy` 三种网页环境；代理模式必须由两条检测链路确认同一出口 IP。
- 支持语言、时区、粗略位置策略跨设备同步，但不上传 Cookie、密码、网页登录态、出口 IP、
  本机清理记录或代理凭据。
- WebRTC 使用 `disable_non_proxied_udp`，地理位置默认拒绝。
- 修复清理后首次打开停留在 `environment bootstrap` 空白页；增加瞬时网络错误重试。
- GPT/Claude/Gemini 网页红色加载错误条增加关闭按钮，恢复加载后自动消失。

协作后端落地原则：先与线上文件 `diff`，回收线上基线，再做增量修改；保留旧路由和旧字段语义，
新增密码复核/隐私配置能力时不得要求旧客户端升级。

### 3.3 1.0.6：网页可见信息表盘与资料环境

已落地：

- 在实际 ChatGPT、Claude、Gemini 页面上下文采集出口 IP、ASN、国家、时区、语言、WebRTC、
  UA、Client Hints、OS/架构、CPU、内存、屏幕、DPR、触控、WebGL/GPU、Canvas、Audio、字体和
  媒体设备摘要。
- 展示出口与网页信息矛盾，包括时区、语言、SOCKS、WebRTC、本地 IP 和 `webdriver`。
- 清除/重建前保存 `beforeClear` 摘要，重新打开后可做 19 项前后比较。
- Mac/Windows 快照通过手动 JSON 导出/导入比较；快照和本机资料 ID不自动上传。
- “重建资料环境”会完成清理、生成新的本机资料 ID，并切换到新的持久化分区。
- 指纹标准化默认关闭；启用后按资料 ID稳定 CPU/内存/屏幕/DPR/触控、Canvas/Audio 等摘要。
- ChatGPT、Claude、Gemini 导航与示意页使用各自品牌轮廓图标。
- Windows 发布规范明确区分 portable 与 NSIS；正式 Release 必须使用 NSIS + `latest.yml` +
  `.blockmap`，并验证 sing-box/frpc 固定校验值。

### 3.4 1.0.7 候选：macOS 原生平台与 Electron 43

候选分支已实现、尚未发布：

- macOS/Linux 收到旧版同步的 `us-windows` 预设时，运行时自动回落到 `balanced`。
- macOS 设置页不再提供 Windows 预设；Windows 主机仍可读取旧配置，保证配置兼容。
- Mac 保留真实 macOS 平台、UA、字体、GPU 和架构；国家/语言/时区属于独立环境设置。
- Electron 固定升级到 `43.1.0`，对应 Chromium 150；开发/打包 Node 最低版本设为 `22.12.0`。
- `electron-builder 26.15.3` 在本项目依赖扫描阶段发生停滞，当前回退并保留已验证可打包的
  `24.13.3`。这是构建链遗留，不进入最终应用运行时；升级前必须复现、解决并完成双平台打包。

## 4. 清理、重建与“新环境”的真实边界

清除/重建能保证的是本机 Chromium 分区层面的隔离：

1. 关闭目标 AI 服务全部 `WebContentsView` 和在途连接。
2. 清理目标 Session 的网站数据与缓存。
3. 重建时生成新资料 ID并切换到新持久化分区。
4. 其它 AI 服务分区、ShareGPT 业务数据和用户文件保持不变。

它不能清除或承诺隐藏：

- 第三方服务商已经保存的账号、付款、手机号、SSO、组织、登录、封禁或风控历史；
- 真实出口 IP/ASN及其历史信誉；
- Electron/Chromium、TLS、HTTP/2、字体、媒体和未标准化 API 的全部行为差异；
- 不同物理设备或跨地区登录造成的服务端关联。

因此产品只能描述为“清理本机站点数据、重建本机资料环境、检测可见矛盾”，不能宣传为
“反封号”“隐藏代理”“绕过地区限制”或“绝对不可识别”。

## 5. 服务器部署与兼容更新规范

### 5.1 更新前

1. 确认所有线上实例、监听端口、进程管理方式和各自数据目录；多实例不能共用写入文件。
2. 下载或只读查看线上程序文件，与本地版本做 `diff`，区分线上专有修补和仓库缺失内容。
3. 备份源码、环境文件和 JSON 数据；备份必须可恢复，且不得提交真实凭据。
4. 本地合并线上有效差异并运行服务端测试，之后才部署。

### 5.2 增量部署

1. 先更新一个实例或测试端口，健康检查通过后再逐个更新其它实例。
2. 不删除旧 API、不改变旧字段类型、不让未知字段成为必填项。
3. 验证旧版客户端登录/聊天/配置、新版密码复核/隐私同步、管理端和 WebSocket。
4. 观察日志和数据写入，再切换下一实例；失败时恢复源码和数据快照。
5. 长期部署应从 `screen` 迁移到 `systemd`，使用专用低权限用户、回环监听和 HTTPS 反代。

完整的新部署步骤见 [`SELF_HOSTING.md`](SELF_HOSTING.md)。FRP 公网服务器只是入口时，AI 网站
看到的是树莓派/家中主机或 mihomo 上游节点的最终出口，不是 FRP 服务器 IP。

## 6. Mac 与 Windows 构建规范

### 6.1 macOS

- 正式命令：`npm run dist:mac`。
- 当前只构建 Apple Silicon `arm64` DMG；未配置 Developer ID，因此是未正式签名/未公证包。
- 2026-07-12 曾生成 Electron 43 本地验证包：`release/ShareGPT-1.0.6-arm64.dmg`，约 133 MB，
  SHA-256 为 `aa517a967d2c4ddc03f876e9e4f6aea3a77d97e6ae886c6974ead266531e52a1`。
- 该文件是本地验证产物，不应覆盖已发布的 1.0.6；升 1.0.7 后必须重新构建并生成新校验值。

### 6.2 Windows

- `npm run dist:win` 是 portable 自测包，不生成自动更新文件。
- `npm run dist:win:installer` 才是正式 NSIS 安装包，会生成 `latest.yml` 和 `.blockmap`。
- 1.0.6 实测 portable 约 87.85 MiB、NSIS 约 97.81 MiB；小约 10 MiB 的主要原因是目标类型不同，
  不是应用资源必然丢失。精确基线和检查项见 [`RELEASING.md`](RELEASING.md)。
- 每次正式 Windows 构建后必须运行 `npm run verify:release-win`，返回 `target: "nsis"` 和
  `ok: true`；Mac 结果不能代替 Windows 验证。
- 2026-07-31 已在 Windows x64、Node `24.14.0` 上完成 Electron `43.1.0` 候选构建；隔离
  NSIS 为 `126179299` bytes，SHA-256 为
  `074f225016ed7feef17c60e42bf43b78c74d2f5e8d926767d79a2edacce9ff09`，ASAR 中本机
  `.npm-cache` 条目为 0。
- 该文件仍使用 `1.0.6` 名称，只是本地验证证据，不能上传或替换已发布资产；升到 `1.0.7`
  后必须从发布提交重新构建并记录新校验值。

## 7. 已执行的验证与验收标准

### 7.1 macOS arm64（2026-07-12）

Electron `43.1.0`：

- `npm test`：21/21 通过，覆盖旧客户端兼容、密码复核、隐私设置、分区清理、资料轮换和重试。
- `npm run typecheck:main`：通过。
- `npm run lint`：0 error；仓库仍有 50 个历史 warning，不能误写成“全无告警”。
- `npm run build:next`：通过。
- `npm run verify:browser-privacy`：真实 Electron 本地页验证通过；Cookie、LocalStorage、IndexedDB、
  Cache Storage、Service Worker 清除成功，其它分区不受影响，WebRTC 未泄漏本地 IP。
- `npm run verify:browser-privacy-ui`：三服务清除/重建、密码错误拒绝、表盘、同步边界全部通过；
  测试阻断非本地请求，没有访问真实 AI 网站。
- `hdiutil verify`：DMG 校验有效；包内 Electron Framework 版本确认为 `43.1.0`。
- `npm audit --omit=dev`：生产依赖 0 漏洞。旧 `electron-builder 24.13.3` 的开发构建依赖仍有
  audit 告警，需随构建链升级处理，不能把“生产依赖 0”写成“所有依赖 0”。

### 7.2 Windows x64（2026-07-31）

- Node `24.14.0`、Electron `43.1.0`：`npm test` 22/22、主进程类型检查和 renderer 构建通过。
- 真实 Electron 隐私清理与 UI 验证通过；未访问真实 AI 网站。
- NSIS、`latest.yml`、`.blockmap`、sing-box/frpc SHA-256 校验通过；打包主程序版本为 `43.1.0`。
- 发布校验确认 renderer 入口存在，且 ASAR 不包含任何本机 `.npm-cache`。

## 8. 已踩过的坑与固定处理方式

1. **清理后首次打开空白**：不能让页面停留在 `data:` bootstrap；必须重建标签、保持初始化遮罩，
   对瞬时网络错误有限重试。
2. **错误条无法关闭**：网页加载错误必须有显式关闭入口，页面恢复后自动清理旧错误。
3. **Windows 包变小**：先确认 portable/NSIS 身份和 `latest.yml`，再判断是否漏文件。
4. **Electron 31 `clearData()` 崩溃**：保留逐项 `clearStorageData()` + 独立缓存 API；升级 Electron 后
   仍通过真实 Chromium 回归，不因为版本升级盲目替换稳定实现。
5. **Electron 运行时与 UA**：只移除 Electron/应用标识，Chrome 版本必须取真实 Chromium 版本，
   不能宣称一个比实际 TLS/Client Hints 更高的浏览器版本。
6. **跨平台伪装矛盾**：Mac 不使用 Windows UA/WebGL/媒体摘要；旧 `us-windows` 配置在非 Windows
   主机自动降级。
7. **electron-builder 26 停滞**：不能只改依赖版本；必须以实际 NSIS/DMG 成功作为升级完成证据。
8. **ASAR 解包覆盖源码**：不要在仓库根目录运行
   `asar extract-file <app.asar> package.json`。旧 CLI 会把文件写到当前目录并覆盖真实
   `package.json`；应切到临时目录，或使用 `@electron/asar` 的 `extractFile()` API只读内存。
9. **同版本覆盖 Release**：代码或 Electron 变化后必须升版本并重建，不能用不同 SHA 的文件替换
   已公开同名资产，否则更新元数据、用户缓存和可追溯性都会失效。

## 9. 下一次继续工作的顺序

1. 将应用版本定为 `1.0.7`，更新 `CHANGELOG.md` 和应用内更新日志。
2. 在 Mac 重新运行全部校验并构建正式 1.0.7 DMG，记录大小、SHA-256 和签名状态。
3. Windows 拉取升版后的同一发布提交，使用 Node 22.12+ 安装依赖；重新运行测试、UI/隐私
   验证、NSIS 构建和 `verify:release-win`，记录正式 1.0.7 的体积与 SHA-256。
4. 单独解决 electron-builder 26 依赖扫描停滞；成功前不把版本升级写入正式构建流程。
5. 提交时只包含明确范围内文件；提交前复核 diff、凭据扫描、锁文件一致性和双平台证据。
6. 发布新 tag 和 Release；Windows 必须同时上传 NSIS、`latest.yml`、`.blockmap`，Mac 上传 DMG。
7. 用旧客户端验证兼容、用新客户端验证新增功能；确认后再逐实例增量更新协作后端。
