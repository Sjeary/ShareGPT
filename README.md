<div align="center">

# ShareGPT 桌面客户端

**把 ChatGPT、Claude、Gemini、翻译与协作放进一个客户端；既可独立在本机使用，也可连接自托管团队。**

_A cross-platform desktop workspace for embedded AI pages, translation, personal networking, and self-hosted team collaboration._

[![CI](https://github.com/Sjeary/ShareGPT/actions/workflows/ci.yml/badge.svg)](https://github.com/Sjeary/ShareGPT/actions/workflows/ci.yml)
[![version](https://img.shields.io/github/v/release/Sjeary/ShareGPT)](https://github.com/Sjeary/ShareGPT/releases)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)
![electron](https://img.shields.io/badge/Electron-43.1.0-47848F)
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

ShareGPT 提供两种彼此隔离的使用方式：个人工作区无需团队账号，代理、翻译接口和 AI 网页登录状态只保存在本机；团队工作区连接你或组织自托管的协作服务器，由管理员统一下发网络与翻译配置，并提供聊天、权限和用量管理。两种工作区可以随时切换，但不会互相读取或覆盖 ChatGPT、Claude、Gemini 的 Cookie、历史会话和本地设置。

整套由三部分组成：

- **桌面客户端**：内嵌三家 AI 网页，提供持久化多环境、翻译工作台、个人网络配置和可选的团队协作。
- **协作服务端**（`collab_server2/`）：Node.js `http` + `ws` 服务，负责账号、聊天、权限、配置和用量数据；可按团队运行独立实例。
- **管理控制台**（`admin_console/`）：管理用户、代理线路、各 AI 默认线路、托管翻译、授权和用量统计。

## ✨ 功能特性

- **个人与团队工作区**：首次启动会引导选择使用方式；个人和团队的网络、翻译设置及 AI 网页数据分别持久化，切换时不会迁移或清除另一侧数据。
- **AI 工作区**：内嵌 ChatGPT / Claude / Gemini（可在设置里开关入口），支持多标签、多环境、明暗主题和全屏显示。
- **翻译工作台**：区分“阅读翻译”和“写给 AI”；支持读取选区或页面、可编辑发送预览、草稿保护、停止任务、拖动调宽，以及个人或团队托管的翻译接口。
- **网络 / 代理（基于 [sing-box](https://sing-box.sagernet.org/)）**：
  - 个人工作区可使用自己的 HTTP 或 SOCKS5 代理；团队普通成员自动同步管理员配置，无需查看连接凭据和内部端口。
  - 管理员可分别为 ChatGPT、Gemini 和 Claude 推荐默认线路；高级用户可在自己获授权的线路中调整多个 AI 环境。
  - 只对 AI 站点**按内置域名清单**走代理，其余直连/走本机代理。
  - **代理检测**：检查 AI 页面是否绑定到预期线路；线路或出口校验失败时停止导航，不静默切换出口。
- **协作聊天**：私聊 / 房间消息、图片与文件、撤回 / 已读 / 回复 / 转发、离线补同步、可自定义提醒；管理员可禁止某人使用聊天。
- **使用统计**：AI 网页只记录已确认成功发送的消息；托管翻译按用户和配置统计请求、字符、token 与估算费用，不保存原文或译文。
- **管理控制台**：用户与权限、团队网络、多线路授权、各 AI 默认线路、加密托管翻译配置、用量和版本信息集中维护。
- **应用内更新**：以 **GitHub Releases** 为更新源（参考 [cc-switch](https://github.com/farion1231/cc-switch)，**不经过任何自建服务器**）。**Windows 原地无感更新**——后台下载、自动安装并重启，快捷方式与安装位置不变，账号/聊天记录/网页登录态全部保留；macOS 暂为下载安装包方式。
- **网页隐私与环境**：可分别重置 ChatGPT / Gemini / Claude 的网页登录数据（密码二次确认）；支持美国/代理出口一致的语言、时区和可选粗略位置，并阻止 WebRTC 非代理 UDP 泄漏。环境策略可跨设备同步，Cookie 和网页登录态不上传。
- **跨平台**：Windows 与 macOS（Apple Silicon）。

## 🚀 快速开始（普通用户）

1. 到 [Releases](../../releases) 下载对应平台的正式安装包（Windows `.exe` / macOS `.dmg`）。
2. 首次启动选择“仅在本机使用”或“连接团队”。选错后可以返回，也可以稍后从账户页切换。
3. 个人使用时填写自己的代理和翻译接口；连接团队时使用管理员提供的 HTTPS 服务地址、用户名和密码，普通成员会自动同步团队网络配置。
4. 打开 ChatGPT、Claude 或 Gemini，并分别完成对应网站登录。网站账号与 ShareGPT 团队账号不是同一套身份。

> 正式 GitHub Release 应带有有效的 Windows Authenticode 或 macOS Developer ID 签名与公证。若系统显示未知发布者、签名无效或来源不明，请先停止安装并核对 Release 页面、文件名和发布者；不要通过关闭安全检查或移除隔离属性来绕过警告。

## 🛠️ 部署指南（管理员 / 自建）

整套 = **协作服务端** + **管理控制台** + 给用户的**客户端安装包** +（可选自建的）**集中代理出口**。

> 本项目是**自建 / 自部署**的：每个团队（群）请运行**自己的**协作服务端与代理服务器、配置**自己的**密钥与节点。本仓库不提供任何公共服务器，也不应连接他人的服务器。

> **第一次部署请直接阅读：[ShareGPT 自托管完整教程](docs/SELF_HOSTING.md)。** 该教程从空 Ubuntu 服务器开始，完整覆盖 HTTPS 协作后端、管理员初始化、备份恢复、公网服务器直接出口、FRP + 树莓派 + mihomo 出口、机场节点分发、逐层验收和故障排查。下面只保留组件速览。

### 1. 协作服务端

源码在 [`collab_server2/`](collab_server2/)，使用 Node.js 内置 `http` 与 `ws`。默认只监听 `127.0.0.1:8088`，生产环境应由 Caddy/Nginx 提供 HTTPS 与 WebSocket 反向代理。

| 环境变量                          | 说明                                                                                                                             | 默认                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `HOST`                            | 监听地址；生产默认只允许本机反向代理访问                                                                                         | `127.0.0.1`                        |
| `PORT`                            | 监听端口                                                                                                                         | `8088`                             |
| `USERS_FILE`                      | 用户库 JSON 路径                                                                                                                 | `data/users.json`                  |
| `CHAT_HISTORY_FILE`               | 聊天记录路径                                                                                                                     | `data/chat_history.json`           |
| `GPT_USAGE_FILE`                  | 使用统计存储（同目录还会放 `gemini_usage.json` / `claude_usage.json` / `feedback.json` / `proxy_missing.json` / `airport.json`） | `data/gpt_usage.json`              |
| `CLIENT_BOOTSTRAP_FILE`           | 下发给客户端的默认配置（代理 / 更新 / 机场节点）                                                                                 | `data/client_bootstrap.json`       |
| `RELEASES_DIR` / `RELEASE_STORE`  | 版本安装包目录                                                                                                                   | `data/releases` / `release_shared` |
| `SHAREGPT_TRANSLATION_MASTER_KEY` | 加密团队翻译 API Key 的 32 字节主密钥；必须独立备份                                                                              | —                                  |
| `TRANSLATION_PROFILES_FILE`       | 团队翻译配置密文                                                                                                                 | `data/translation_profiles.json`   |
| `TRANSLATION_USAGE_FILE`          | 翻译用量元数据，不保存原文或译文                                                                                                 | `data/translation_usage.json`      |
| `DEV_TOKEN`                       | 开发者全局发布密钥（留空则关闭该入口）                                                                                           | —                                  |

> 做"多群"只需为每个实例指定**不同的数据目录**和 `PORT`，可用 systemd 等托管。**请使用你自己的密钥/账号，切勿使用任何示例值。**

### 2. 管理控制台

[`admin_console/`](admin_console/) 是独立 Electron 管理端。构建：`npm run dist:admin:win`。登录后可管理用户和高级 AI 权限、导入及授权多条代理线路、分别设置三种 AI 的默认线路、配置加密托管翻译服务并查看用量，以及维护版本信息。

### 3. 集中代理出口（统一出口 IP，可选）

团队可以让 AI 流量使用统一出口，也可以为 ChatGPT、Gemini、Claude 分别推荐不同线路。管理员集中维护线路和授权，普通成员无需接触节点凭据或自行选择出口。两种自建出口形态做的是同一件事：

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
npm run dist:win:sender     # Windows 客户端
npm run dist:mac:sender     # macOS 客户端（自动先编译渲染层）
npm run dist:admin:win      # 管理控制台
```

**发布新版本 / 自建更新源**（维护者 / fork）：应用以 **GitHub Releases** 为自动更新源，不经过协作服务器。完整的签名、构建、资产和发布门禁见 [docs/RELEASING.md](docs/RELEASING.md)。

1. 改 `package.json` 版本号 → 完整桌面版执行 `npm run dist:win:installer`（NSIS）和 `npm run dist:mac`；拆分发送端才使用 `dist:win:sender` / `dist:mac:sender`。
2. Windows 正式包必须通过 Authenticode 签名与时间戳校验；macOS 正式包必须通过 Developer ID、hardened runtime、公证和 staple 校验。本地未签名或 ad-hoc 候选不得上传 Release。
3. 在自己的 GitHub 仓库创建 `v<版本号>` Release，并上传工作流要求的完整资产。portable 只用于本地自测，不作为更新包。

**目录结构**

```
src/                  主程序源码（main/ 主进程，renderer-next/ 新版界面）
admin_console/        独立管理端（ui/ 是 React 源码）
collab_server2/       协作服务端源码（Node http + ws）
scripts/              构建前二进制准备脚本
build/                打包资源（图标、bin/ 放第三方二进制）
```

**技术栈**：Electron 43.1.0（Chromium 150）· Vite · React 19 · TypeScript · Tailwind v4 · shadcn/ui · Zustand；代理基于 sing-box；协作服务端基于 Node.js `http` 与 `ws`。

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
