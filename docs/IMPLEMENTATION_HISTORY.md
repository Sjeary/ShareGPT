# ShareGPT 实施、验证与运维历史

> 更新日期：2026-09-03。本文面向维护者，记录已经落地的版本边界、稳定实现原则和发布验收要求。面向用户的变化以 [`CHANGELOG.md`](../CHANGELOG.md) 为准，逐次发布步骤以 [`RELEASING.md`](RELEASING.md) 为准。

## 1. 当前状态

- 最新正式版本是 `v1.0.8`，发布于 2026-08-26；对应源码提交为 `810a37ba86875503f65e0989f35627ecff87214c`。
- `1.0.9` 仍是待发布版本，没有正式 tag。候选代码只有通过完整 CI、真实 Electron 验收、安装升级与签名检查并进入 `main` 后，才可以创建正式 tag。
- 桌面端使用 Electron `43.1.0`，开发和打包要求 Node.js `22.12.0` 或更高版本。依赖的大版本升级不与 1.0.9 发布收尾混合。
- 协作服务端继续使用加法兼容策略：旧 1.0.x 客户端可以忽略未知字段，新功能不能改变旧登录、聊天、配置和更新接口的既有语义。
- 真实密码、SSH 私钥、Cookie、Token、付款资料、代理订阅、节点密钥、签名证书和本机运维信息不得进入 Git、Issue、Release notes 或截图。

## 2. 公共资料入口

| 主题         | 主要文档/代码                                                   | 作用                                            |
| ------------ | --------------------------------------------------------------- | ----------------------------------------------- |
| 用户版本变化 | [`CHANGELOG.md`](../CHANGELOG.md)                               | 已发布版本与待发布用户功能                      |
| 架构         | [`ARCHITECTURE.md`](ARCHITECTURE.md)                            | 客户端、协作服务端、管理端和代理链路            |
| 自托管       | [`SELF_HOSTING.md`](SELF_HOSTING.md)                            | HTTPS、回环监听、数据与翻译密钥备份、多线路配置 |
| 浏览器隐私   | [`browser-privacy.md`](browser-privacy.md)                      | 分区清理、个人/团队隔离、环境模式和产品边界     |
| 发布         | [`RELEASING.md`](RELEASING.md)                                  | 版本、CI、签名、安装包、tag 与 Release 契约     |
| macOS 签名   | [`MACOS_SIGNING.md`](MACOS_SIGNING.md)                          | Developer ID、公证、staple 与 Gatekeeper 验证   |
| 回归验证     | `src/main/test/`、`collab_server2/test/`、`scripts/verify-*.js` | 单元、合同与真实 Electron 行为验收              |

本机路径、未公开构建产物和运维提醒只属于维护者的私有环境，不应在公共仓库中建立第二份状态文档。

## 3. 版本落地历史

### 3.1 1.0.4：安装与基础体验

- Windows NSIS 使用向导式安装并允许选择安装目录。
- 消息通知、Emoji Kitchen 资源和新手引导得到完善。

### 3.2 1.0.5：按服务清理与环境配置

- ChatGPT、Gemini、Claude 使用独立持久化 Session，可逐个清理且没有“全部清除”。
- 组织账号清理前由协作服务端复核当前密码；密码不写入设置或日志。
- 支持 `system`、`us`、`proxy` 网页环境、代理出口检测、受控地理位置与 WebRTC 防泄漏。
- 修复清理后首次打开停留在空白 bootstrap 页面，并为瞬时网络错误增加有限重试。

### 3.3 1.0.6：网页可见信息与资料环境

- 在实际 AI 网页上下文采集网络、语言、时区、平台、硬件与浏览器可见摘要。
- 清除前保存摘要并支持前后比较；重建会生成新的本机资料 ID 和持久化分区。
- 指纹标准化默认关闭；启用时使用按资料 ID 稳定的值，不在每次加载时随机变化。
- Windows 发布规范区分便携包与可更新 NSIS 安装包。

### 3.4 1.0.7：原生平台一致性与 Electron 43

- macOS/Linux 不再套用 Windows 平台预设；旧 `us-windows` 配置在非 Windows 运行时回落到兼容模式。
- 桌面端升级到 Electron `43.1.0`，开发和打包最低 Node.js 版本调整为 `22.12.0`。
- 更新生产依赖锁，并继续要求在真实 Chromium 和两种操作系统上验证浏览器清理与安装包。

### 3.5 1.0.8：多环境、多线路与翻译侧栏

- ChatGPT、Gemini、Claude 支持彼此独立的多环境与网页登录态。
- 管理员可以配置多个代理线路并按用户授权；客户端验证实际出口后才开放网页。
- 增加翻译侧栏和选中文本入口，并完善 Claude 网页入口、缩放和快速切换稳定性。

### 3.6 1.0.9：当前待发布范围

- 以 server URL 路径和服务端确认的大小写用户名构成唯一 Principal，保证账号 A/B/A 的设置、授权与网页登录态隔离恢复。
- 增加个人工作区。它不依赖团队登录，并使用独立的配置作用域和 Chromium 分区；个人与组织数据互不复用。
- 收口登录、设置、管理员权限升级、线路授权 epoch、休眠恢复、renderer 重建和 AI 分区生命周期。
- 将翻译改为可调整宽度、可停止的工作台；支持本地配置与管理员托管配置，服务端加密保存托管密钥并记录授权用量。
- bilingual composer 使用 document/workspace/generation 身份和显式确认，只在网页确认成功发送后计量。
- 管理员可为 ChatGPT、Gemini、Claude 分别推荐默认线路；普通用户跟随策略，高级用户在授权范围内选择。
- 保持 GitHub Latest Release tag 为桌面更新版本权威，并固定应用身份、旧 DMG 下载别名、签名与 CI 合同。

以上内容仍是候选行为，不代表已经发布。最终用户说明必须等候选通过审核后再从 `Unreleased` 固定版本日期。

## 4. 数据隔离与清理边界

清除或重建只能保证本机 Chromium 分区层面的隔离：

1. 关闭目标 AI 服务的相关 `WebContentsView` 和在途连接。
2. 清理目标 Session 的网站数据与缓存。
3. 重建时生成新资料 ID 并切换到新持久化分区。
4. 其它 AI 服务、其它 Principal、ShareGPT 业务数据和用户文件保持不变。

它不能删除第三方服务商已经保存的账号、付款、SSO、组织、登录、封禁或风控历史，也不能隐藏真实出口信誉或承诺不同设备不可关联。因此产品只能描述为“清理本机站点数据、重建本机资料环境、检测可见矛盾”，不能宣传为“反封号”“隐藏代理”或“绕过风控”。

## 5. 服务端部署与兼容更新

1. 服务默认只监听 `127.0.0.1`，公网访问必须经过 HTTPS 反向代理。不要让一键脚本自动开放服务端口。
2. 运行数据保存在独立数据目录中，部署代码时不得用 `--delete` 删除数据。多实例不能共用可写 JSON 文件。
3. 托管翻译密文和 `SHAREGPT_TRANSLATION_MASTER_KEY` 必须一起备份；密钥不得提交或下发客户端。
4. 更新前比较线上程序与目标 tag/提交，备份环境文件和数据，再在测试实例验证旧客户端、新客户端、管理端和 WebSocket。
5. 不删除旧 API、不改变旧字段类型、不把新增字段变成旧客户端的必填项。临时服务器失败不能伪装成权威的空授权。

完整步骤见 [`SELF_HOSTING.md`](SELF_HOSTING.md)。

## 6. 构建、签名与发布

### macOS

- 本地候选可以使用文档规定的 ad-hoc 路径，但不能作为公开 Release 产物。
- 公开版本必须使用 Developer ID、hardened runtime、公证与 staple，并验证 Team ID、Gatekeeper、版本和应用身份。
- 当前正式目标是 Apple Silicon `arm64`；若以后增加架构，需要独立的构建和升级验收。

### Windows

- 本地未签名 NSIS 只用于结构验证，不得发布。
- 公开版本必须使用有效 Authenticode 签名和时间戳，并验证安装器、unpacked exe、publisher 与更新元数据。
- 正式资产包括 NSIS 安装包、`.blockmap` 和 `latest.yml`；`latest.yml` 不能覆盖与 GitHub Latest Release tag 不一致的版本。

两平台必须从同一个已进入 `main` 的发布提交构建。已公开的 tag 和同名资产不得被不同字节的文件覆盖。

## 7. 合并与发布验收

提交或 PR 至少执行与改动相关的测试；发布候选按 [`RELEASING.md`](RELEASING.md) 执行完整门禁，包括：

```bash
npm test
npm run typecheck:main
npm run lint
npm run format:check
npm run verify:signing-boundaries
npm run verify:release-contract
npm run test:release
npm --prefix src/renderer-next run build
npm --prefix admin_console/ui run build
```

此外还必须完成以下行为验收：

- 个人/团队 Principal 切换、A/B/A 恢复与网页分区隔离；
- AI 首次绑定、同线路复用、换线路验证、快速切换、renderer death 和休眠恢复；
- composer 启用/禁用、SPA 导航、取消、确认发送与成功发送后计量；
- 组织密码复核与个人工作区本地确认下的单服务清理；
- 1.0.8 到候选版本的本机升级，验证应用身份、设置、协作记录和网页登录态连续性；
- Windows 正式构建机的 NSIS 与 Authenticode 验证，以及 macOS 的 Developer ID、公证和 Gatekeeper 验证；
- GitHub Actions 对最终远端提交全部通过。

## 8. 稳定维护经验

1. 清理后首次打开不能停在 `data:` bootstrap；必须重建标签并对瞬时网络错误有限重试。
2. 网页加载错误要有明确恢复或关闭路径，成功加载后清除旧错误状态。
3. 判断 Windows 包体积前先区分 portable 与 NSIS，并检查实际资产和更新元数据。
4. 保留已验证的逐项 `clearStorageData()` 与缓存 API；不能只因 Electron 升级就替换稳定清理路径。
5. UA 中的 Chrome 版本必须来自实际 Chromium 运行时，不能伪装成与 TLS/Client Hints 不一致的版本。
6. macOS 不使用 Windows UA、WebGL 或媒体摘要；国家、语言、时区与操作系统平台是不同维度。
7. 依赖升级只有在真实 NSIS/DMG 构建、安装和升级验证完成后才算落地。
8. 解包 ASAR 必须在隔离临时目录或通过只读 API 完成，不能让旧 CLI 覆盖仓库源码。
9. 自动更新遇到 tag、版本、文件名、签名或 hash 不一致必须停止，不能猜测或静默降级。

## 9. 1.0.9 后续顺序

1. 对完整 `v1.0.8..候选 SHA` 生产调用链、测试覆盖与公开内容执行审核和隐私扫描。
2. 只修复审核接受的发布阻塞问题，并保持独立行为的原子提交。
3. 运行完整本地 CI 等价门禁、真实 Electron 验收和 1.0.8 升级安装验证。
4. 让最终候选进入 `main` 并等待 GitHub CI 全部通过。
5. 获得明确授权后再创建签名产物、tag 和 Release；发布当天才固定版本日期。
6. 1.0.9 完成后再另行规划 Proxy Policy V1、SQLite、群聊和好友功能。
