<div align="center">

# ShareGPT 桌面客户端

**把 ChatGPT / Claude / Gemini「装进一个客户端」，由管理员统一配置网络，并整合团队协作与个人知识工作的跨平台桌面应用。**

_A cross-platform desktop app that embeds ChatGPT / Claude / Gemini with admin-managed networking, bilingual workflows, team collaboration, and local-first productivity tools._

[![CI](https://github.com/Sjeary/ShareGPT/actions/workflows/ci.yml/badge.svg)](https://github.com/Sjeary/ShareGPT/actions/workflows/ci.yml)
[![version](https://img.shields.io/github/v/release/Sjeary/ShareGPT)](https://github.com/Sjeary/ShareGPT/releases)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)
![electron](https://img.shields.io/badge/Electron-43-47848F)
![react](https://img.shields.io/badge/React-19-61DAFB)
[![license](https://img.shields.io/github/license/Sjeary/ShareGPT)](LICENSE)

</div>

---

## ⚠️ 重要声明（使用前请务必阅读）

> **本项目仅供技术学习与研究交流，不是面向公众的服务，也不是商业产品。**

- **服务条款风险**：本项目以内嵌网页方式访问 OpenAI / Anthropic / Google 等第三方 AI 服务，**可能不符合相应服务商的使用条款**，存在账号被限制或封禁的风险。是否使用、如何使用，由使用者自行判断并承担后果。
- **合规使用**：本项目包含网络代理相关能力。**请仅在符合你所在国家/地区法律法规的前提下使用**，不得用于任何违法违规用途。
- **风险自负**：因使用本项目而导致的账号封禁、服务中断、数据丢失、网络问题或任何直接/间接损失，**作者概不负责，亦不提供任何形式的可用性保证**。
- **无隶属关系**：本项目与 OpenAI、Anthropic、Google 等任何第三方厂商**无任何隶属、合作或背书关系**；相关名称、商标归各自所有者。
- **开源（GPL-3.0）**：本项目以 [GPL-3.0](LICENSE) 授权——可自由使用、修改、分发，但**分发衍生作品时必须以相同许可证公开源码**。
- **如不同意以上任一条款，请勿使用本项目。** 继续使用即视为已知悉并接受上述全部内容。

---

## 简介

团队里常常很多人都要用 ChatGPT / Claude / Gemini，但**共用账号**时，大家来自各不相同的网络出口，**IP 不统一很容易被服务商风控、导致回答质量下降（俗称"降智"）**；再加上各自配置网络门槛高、又难以统一管理。

ShareGPT 把这些一次性收拢：**装上、登录、即用**——网络与配置由管理员集中下发，所有成员的 AI 流量可从**同一个出口 IP** 出网，既省去各自配置，也让共用账号更稳定可信；同时内置双语网页交互、团队协作聊天、日历待办、知识库、专注计时、用量统计与统一的管理后台。

整套由三部分组成：

- **客户端**：内嵌三家 AI 网页（多标签、各自独立会话、登录态持久化），把 AI 站点流量按域名清单走代理；内置双语交互、协作聊天与本地优先的个人生产力工具。
- **协作服务端**（`collab_server2/`）：基于 Node.js `http` 和 `ws`，负责账号、聊天、配置下发、版本分发；运行时仅依赖 `ws`，可多实例（多群）。
- **管理控制台**（`admin_console/`）：管理员用来管用户、下发代理配置、查看反馈、发布版本。

## ✨ 功能特性

- **AI 工作区**：内嵌 ChatGPT / Claude / Gemini（可在设置里开关入口），支持多标签、明暗主题跟随、沉浸/全屏（F11）；Claude 可将明确打开的外部 HTTP/HTTPS 页面放入独立内部标签。
- **高级 AI 多环境（按权限开放）**：同一 AI 服务可建立多个相互隔离的工作环境，每个环境拥有独立网页登录状态和管理员分配的托管线路；支持线路健康检查，并按用户控制高级功能权限。
- **三网页端双语翻译（所有登录用户）**：支持右键或自动翻译网页选区、整页翻译，以及把中文提问预览、翻译填入或翻译后发送；目标语言默认英文，直接发送非目标语言内容前会要求确认。译文显示在 ShareGPT 侧栏，不替换原网页内容。
- **网络 / 代理（基于 [sing-box](https://sing-box.sagernet.org/)）**：
  - 管理员统一下发连接配置，成员**首登自动拉取**，无需手配。
  - 只对 AI 站点**按内置域名清单**走代理，其余直连/走本机代理。
  - **代理检测**：实时显示页面流量是否全部走代理；发现"会用到却没走代理"的域名时**自动加入本机清单并上报管理员**，一键重启即时生效。
  - **可选「机场订阅」模式**：管理员粘贴 Clash 订阅、选一个节点下发，客户端可选择走机场节点（与统一代理并存，默认统一）。
- **协作聊天**：私聊 / 房间消息、图片与文件、撤回 / 已读 / 回复 / 转发、离线补同步、可自定义提醒；支持 emoji 输入、消息表情回应、动态大表情和 Emoji Kitchen 组合；管理员可禁止某人使用聊天。
- **日历、待办与备忘**：个人日历提供月 / 周 / 日视图、多日历、重复事件和 `.ics` 导入；团队日历支持共享、邀请与 RSVP；待办支持智能视图、优先级、标签、子任务、重复规则和自然语言快速添加，并可同步到个人日历。
- **笔记 / 知识库**：本地真实 `.md` 仓库，可直接与 Obsidian vault 配合；支持双链与反链、全文检索、标签与属性、关系图谱、Canvas、数据库视图、AI 写作辅助和可选云同步。
- **专注 / 番茄钟**：专注、短休和长休计时，可绑定待办、播放白 / 棕 / 雨声，查看个人统计、连续天数和团队专注排行。
- **使用统计**：按 ChatGPT / Gemini / Claude 维度统计每人查询量与排行。
- **管理控制台**：用户增删改、高级 AI 权限与托管线路分配、客户端代理默认配置下发、机场节点下发、用户反馈查看、"漏走代理域名"汇总、版本发布。
- **应用内更新**：以 **GitHub Releases** 为更新源（参考 [cc-switch](https://github.com/farion1231/cc-switch)，**不经过任何自建服务器**）。**Windows 原地无感更新**——安装时可选择位置，后续后台下载、自动安装并重启，快捷方式与安装位置不变，账号/聊天记录/网页登录态全部保留；macOS 暂为下载安装包方式。
- **网页隐私与环境**：可分别清除或重建 ChatGPT / Gemini / Claude 的网页环境（密码二次确认）；网页可见信息表盘集中展示出口网络、时区语言、WebRTC、浏览器、硬件和图形摘要，提示明显矛盾，并支持清除前后及跨设备快照对比。可选环境标准化默认关闭；环境策略可跨设备同步，Cookie、网页登录态和本机审计快照不上传。
- **可定制导航**：可隐藏不需要的内容入口，并通过长按调整导航顺序。
- **跨平台**：Windows 与 macOS（Apple Silicon）。

## 🌐 双语网页翻译

ChatGPT、Gemini 和 Claude 共用同一套翻译流程，所有已登录用户都可以使用。高级权限只控制多条内置 sing-box 线路和相互隔离的多 AI 环境，不是使用翻译的前提。打开 AI 工作区工具栏中的翻译面板，选择翻译引擎、目标语言并保存后即可长期使用。

| 使用场景     | 操作与结果                                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 临时翻译选区 | 选中文字后右键选择「翻译选中文字」，译文显示在 ShareGPT 侧栏。                                                                                            |
| 连续划词翻译 | 开启「选中网页文字后自动翻译」；此开关默认关闭，仅在三家 AI 官方网页生效，输入框和编辑器中的选区会被忽略。Claude 手动打开的外部网页仍可使用右键显式翻译。 |
| 阅读全文     | 在翻译面板点击「整页翻译」；提取结果和译文显示在侧栏，不修改网站 DOM。                                                                                    |
| 用中文提问   | 输入中文后选择「预览译文」「翻译并填入」或「翻译并发送」，网站输入框最终接收目标语言文本。                                                                |
| 防止误发中文 | 直接在网站输入框按 Enter 或点击发送时，如果内容明显不是目标语言，会先弹出确认。                                                                           |

翻译引擎可以选择 **OpenAI 兼容的 AI 接口**、**LibreTranslate 兼容接口**，或只允许回环地址的**本地离线服务**，所以翻译不一定由 AI 完成。选区、页面正文或提问内容会发送给你配置的翻译服务；使用本地离线服务时不会发送到远程翻译接口。

API 密钥按当前登录身份长期保存在本机设置中，系统支持时使用 Electron `safeStorage` 加密，导出配置时会自动剔除密钥；如果当前系统无法提供 `safeStorage`，兼容模式可能以本机明文保存，因此只建议在可信设备上使用。翻译与发送保护采用 Chromium 隔离世界和不改写页面 DOM 的低侵入设计，但任何内嵌浏览器都不能承诺对网站“绝对不可检测”。完整边界见 [三网页端双语翻译说明](docs/bilingual-web-translation.md)。

## 🚀 快速开始（普通用户）

1. 到 [Releases](../../releases) 下载对应平台安装包（Windows `.exe` / macOS `.dmg`）。
2. 打开应用，**登录**管理员给你的账号；或在登录页「导入配置」导入管理员发的配置文件。
3. 首次登录会自动拉取代理配置。进入「网络 / 代理」，点击**开启代理**。
4. 左侧导航打开 **ChatGPT / Gemini / Claude**，即可使用；用「协作聊天」与同组成员沟通。

> **安装包校验**：正式 GitHub Release 应分别通过 Windows Authenticode 和 macOS
> Developer ID + notarization 校验。源码本地构建默认不是互联网正式包；若 Release 明确标为
> 未签名测试包，系统会显示未知发布者，只应在核对来源和校验值后用于测试。

## 🛠️ 部署指南（管理员 / 自建）

整套 = **协作服务端** + **管理控制台** + 给用户的**客户端安装包** +（可选自建的）**集中代理出口**。

> 本项目是**自建 / 自部署**的：每个团队（群）请运行**自己的**协作服务端与代理服务器、配置**自己的**密钥与节点。本仓库不提供任何公共服务器，也不应连接他人的服务器。

> **第一次部署请直接阅读：[ShareGPT 自托管完整教程](docs/SELF_HOSTING.md)。** 该教程从空 Ubuntu 服务器开始，完整覆盖 HTTPS 协作后端、管理员初始化、备份恢复、公网服务器直接出口、FRP + 树莓派 + mihomo 出口、机场节点分发、逐层验收和故障排查。下面只保留组件速览。

### 1. 协作服务端

源码在 [`collab_server2/`](collab_server2/)，使用 Node.js `http` 与唯一运行时依赖 `ws`。安装依赖后执行 `node server.js`，并用**环境变量**配置：

| 环境变量                         | 说明                                                                                                                             | 默认                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `PORT`                           | 监听端口                                                                                                                         | `8088`                             |
| `USERS_FILE`                     | 用户库 JSON 路径                                                                                                                 | `data/users.json`                  |
| `CHAT_HISTORY_FILE`              | 聊天记录路径                                                                                                                     | `data/chat_history.json`           |
| `GPT_USAGE_FILE`                 | 使用统计存储（同目录还会放 `gemini_usage.json` / `claude_usage.json` / `feedback.json` / `proxy_missing.json` / `airport.json`） | `data/gpt_usage.json`              |
| `CLIENT_BOOTSTRAP_FILE`          | 下发给客户端的默认配置（代理 / 更新 / 机场节点）                                                                                 | `data/client_bootstrap.json`       |
| `RELEASES_DIR` / `RELEASE_STORE` | 版本安装包目录                                                                                                                   | `data/releases` / `release_shared` |
| `DEV_TOKEN`                      | 开发者全局发布密钥（留空则关闭该入口）                                                                                           | —                                  |

> 做"多群"只需为每个实例指定**不同的数据目录**和 `PORT`，可用 systemd 等托管。**请使用你自己的密钥/账号，切勿使用任何示例值。**

### 2. 管理控制台

[`admin_console/`](admin_console/) 是独立 Electron 管理端。构建：`npm run dist:admin:win`。登录后可：用户管理、高级 AI 权限与托管线路分配、客户端代理默认配置下发、（可选）粘贴 Clash 订阅下发机场节点、查看反馈/漏走代理域名、发布版本。

### 3. 集中代理出口（统一出口 IP，可选）

让团队所有成员的 AI 流量从**同一个出口 IP** 出网——共用账号时大家 IP 一致，可明显降低被风控、"降智"的概率，成员也无需各自配置网络。两种部署形态做的是同一件事：

- **Linux 服务器（推荐）**：公网服务器可直接作为出口，或只运行 FRP 入口、把流量转到树莓派/家中小主机上的 mihomo。完整命令见 [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)。
- **有桌面的机器**：装「出口」GUI 版（`npm run dist:win:receiver`），界面里填同样参数、点开启即可。

另有一种不经过统一出口机的方式：管理端可从 Clash YAML 选择一个受支持节点，下发给本群客户端直接连接。它与统一梯子是两条不同链路，凭据暴露范围和稳定性也不同，选择前请阅读完整教程中的“方案 C”。

客户端在「网络 / 代理」里填这套出口的对外参数（服务器 / 端口 / 身份码）即可对接。

> 客户端安装包从 [Releases](../../releases) 下载分发给成员；应用内置自动更新，机制与自建更新源见[从源码构建 / 开发](#-从源码构建--开发)。

## 👩‍💻 从源码构建 / 开发

**环境**：Node.js 22.12+、npm。

```bash
# 安装依赖（主程序 + 渲染层 + 管理端）
npm install
npm --prefix src/renderer-next install
npm --prefix admin_console/ui install

# 准备第三方二进制（sing-box；自建出口时另需转发组件），按 build/bin/README.md 放好
# 然后打包：
npm run dist:win:installer # Windows 正式 NSIS 结构（本地无证书时仍是未签名测试包）
npm run dist:mac           # macOS 正式结构（发布时必须 Developer ID 签名并公证）
npm run dist:admin:win      # 管理控制台
```

**发布新版本 / 自建更新源**（维护者 / fork）：应用以 **GitHub Releases** 为自动更新源（参考 [cc-switch](https://github.com/farion1231/cc-switch)，不经过任何自建服务器；Windows 用 NSIS + [electron-updater](https://www.electron.build/auto-update) 原地无感更新）。

1. 改 `package.json` 与 `package-lock.json` 版本号，执行 `npm run verify:release-contract`；正式桌面身份固定为 `com.sjeary.sharegpt.desktop`。
2. 完整桌面版执行 `npm run dist:win:installer`（NSIS）和 `npm run dist:mac`。Windows 构建后必须执行 `npm run verify:release-win`；portable 与拆分模式只用于本地自测。
3. 在自己的 GitHub 仓库建与包版本一致的 tag `v<版本号>`。Windows 上传 NSIS `.exe`、`latest.yml`、对应 `.exe.blockmap`；macOS 上传 Developer ID 签名并公证的 `.dmg` / `.zip`。不要覆盖已经公开的 Release 资产。
4. 更新界面的版本真源是 GitHub Latest 最终 tag；`latest.yml` 只作为同版本 Windows 安装元数据。fork 后需修改 `homepage` / `repository` 指向自己的仓库。

**目录结构**

```
src/                  主程序源码（main/ 主进程，renderer-next/ 新版界面）
admin_console/        独立管理端（ui/ 是 React 源码）
collab_server2/       协作服务端源码（Node http + ws）
scripts/              构建前二进制准备脚本
build/                打包资源（图标、bin/ 放第三方二进制）
```

**技术栈**：Electron 43 · Vite 8 · React 19 · TypeScript · Tailwind v4 · shadcn/ui · Zustand；代理基于 sing-box；服务端为纯 Node http/ws。

> 架构图与端间协议详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 🤝 欢迎参与

- 觉得有用就点个 ⭐，欢迎在 **GPL-3.0** 下使用与二次开发（衍生作品需保持同等开源）。
- 用着不顺、有想法、发现 Bug —— 欢迎提 [Issue](../../issues)。
- 贡献代码：Fork → 改 → 提 PR，写清楚改了什么、为什么；提交前在渲染层与管理端目录跑 `npx tsc -b` 确保类型检查通过。

## 📄 免责声明（再次强调）

本项目按"**现状（AS IS）**"提供，**仅供技术学习与研究**，不构成任何明示或暗示的担保（包括但不限于适用性、可用性、不侵权）。

- 使用本项目访问第三方 AI 服务**可能违反其服务条款**，由此产生的**账号封禁、服务中断、数据丢失及任何直接/间接损失，由使用者自行承担**，作者不负任何责任。
- 本项目的网络代理能力**仅可在符合所在国家/地区法律法规的前提下使用**，**严禁用于任何非法用途**。
- 本项目与任何第三方厂商**无隶属或背书关系**。
- 你应在合理评估风险后自行决定是否使用，并对自己的使用行为负责。

## 📜 许可证

本项目以 [GNU GPL-3.0](LICENSE) 开源。要点：

- **强 copyleft**：分发衍生作品（含修改版）时，须以 **GPL-3.0** 公开完整源码，并保留版权与许可证声明。
- 软件按「现状」提供，不含任何担保（见 [免责声明](#-免责声明再次强调)）。

完整条款见 [LICENSE](LICENSE)。
