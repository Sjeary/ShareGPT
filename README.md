<div align="center">

# ShareGPT 桌面客户端

**把 ChatGPT / Claude / Gemini「装进一个客户端」，由管理员统一配置网络、面向团队/小组协作使用的跨平台桌面应用。**

_A cross-platform desktop app that embeds ChatGPT / Claude / Gemini, routes them through an admin-managed proxy, and adds team chat._

[![CI](https://github.com/Sjeary/ShareGPT/actions/workflows/ci.yml/badge.svg)](https://github.com/Sjeary/ShareGPT/actions/workflows/ci.yml)
[![version](https://img.shields.io/github/v/release/Sjeary/ShareGPT)](https://github.com/Sjeary/ShareGPT/releases)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)
![electron](https://img.shields.io/badge/Electron-31-47848F)
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
- **开源（AGPL-3.0）**：本项目以 [AGPL-3.0](LICENSE) 授权——可自由使用、修改、分发，但**衍生作品（含作为网络服务对外提供）必须以相同许可证公开源码**。
- **如不同意以上任一条款，请勿使用本项目。** 继续使用即视为已知悉并接受上述全部内容。

---

## 简介

团队里常常很多人都要用 ChatGPT / Claude / Gemini，但**共用账号**时，大家来自各不相同的网络出口，**IP 不统一很容易被服务商风控、导致回答质量下降（俗称"降智"）**；再加上各自配置网络门槛高、又难以统一管理。

ShareGPT 把这些一次性收拢：**装上、登录、即用**——网络与配置由管理员集中下发，所有成员的 AI 流量可从**同一个出口 IP** 出网，既省去各自配置，也让共用账号更稳定可信；同时内置团队协作聊天、用量统计与统一的管理后台。

整套由三部分组成：

- **客户端**：内嵌三家 AI 网页（多标签、各自独立会话、登录态持久化），把 AI 站点流量按域名清单走代理；内置协作聊天与用量统计。
- **协作服务端**（`collab_server2/`）：纯 Node.js 的 http + WebSocket，负责账号、聊天、配置下发、版本分发。零外部依赖、可多实例（多群）。
- **管理控制台**（`admin_console/`）：管理员用来管用户、下发代理配置、查看反馈、发布版本。

## ✨ 功能特性

- **AI 工作区**：内嵌 ChatGPT / Claude / Gemini（可在设置里开关入口），多标签同构，明暗主题跟随，沉浸/全屏（F11）。
- **网络 / 代理（基于 [sing-box](https://sing-box.sagernet.org/)）**：
  - 管理员统一下发连接配置，成员**首登自动拉取**，无需手配。
  - 只对 AI 站点**按内置域名清单**走代理，其余直连/走本机代理。
  - **代理检测**：实时显示页面流量是否全部走代理；发现"会用到却没走代理"的域名时**自动加入本机清单并上报管理员**，一键重启即时生效。
  - **可选「机场订阅」模式**：管理员粘贴 Clash 订阅、选一个节点下发，客户端可选择走机场节点（与统一代理并存，默认统一）。
- **协作聊天**：私聊 / 房间消息、图片与文件、撤回 / 已读 / 回复 / 转发、离线补同步、可自定义提醒；管理员可禁止某人使用聊天。
- **使用统计**：按 ChatGPT / Gemini / Claude 维度统计每人查询量与排行。
- **管理控制台**：用户增删改、客户端代理默认配置下发、机场节点下发、用户反馈查看、"漏走代理域名"汇总、版本发布。
- **应用内更新**：以 **GitHub Releases** 为更新源（参考 [cc-switch](https://github.com/farion1231/cc-switch)，**不经过任何自建服务器**）。**Windows 原地无感更新**——后台下载、自动安装并重启，快捷方式与安装位置不变，账号/聊天记录/网页登录态全部保留；macOS 暂为下载安装包方式。
- **跨平台**：Windows 与 macOS（Apple Silicon）。

## 🚀 快速开始（普通用户）

1. 到 [Releases](../../releases) 下载对应平台安装包（Windows `.exe` / macOS `.dmg`）。
2. 打开应用，**登录**管理员给你的账号；或在登录页「导入配置」导入管理员发的配置文件。
3. 首次登录会自动拉取代理配置。进入「网络 / 代理」，点击**开启代理**。
4. 左侧导航打开 **ChatGPT / Claude**，即可使用；用「协作聊天」与同组成员沟通。

> **macOS 提示**：安装包未做苹果签名，首次打开请**右键 →「打开」**，或在终端执行
> `xattr -dr com.apple.quarantine "/Applications/ShareGPT.app"`。

## 🛠️ 部署指南（管理员 / 自建）

整套 = **协作服务端** + **管理控制台** + 给用户的**客户端安装包** +（可选自建的）**集中代理出口**。

> 本项目是**自建 / 自部署**的：每个团队（群）请运行**自己的**协作服务端与代理服务器、配置**自己的**密钥与节点。本仓库不提供任何公共服务器，也不应连接他人的服务器。

### 1. 协作服务端

源码在 [`collab_server2/`](collab_server2/)，零外部依赖（http + ws）。`node server.js` 即可，用**环境变量**配置：

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

[`admin_console/`](admin_console/) 是独立 Electron 管理端。构建：`npm run dist:admin:win`。登录后可：用户管理、客户端代理默认配置下发、（可选）粘贴 Clash 订阅下发机场节点、查看反馈/漏走代理域名、发布版本。

### 3. 集中代理出口（统一出口 IP，可选）

让团队所有成员的 AI 流量从**同一个出口 IP** 出网——共用账号时大家 IP 一致，可明显降低被风控、"降智"的概率，成员也无需各自配置网络。两种部署形态做的是同一件事：

- **Linux 服务器（推荐）**：纯命令行部署，详见 [docs/RECEIVER.md](docs/RECEIVER.md)。
- **有桌面的机器**：装「出口」GUI 版（`npm run dist:win:receiver`），界面里填同样参数、点开启即可。

客户端在「网络 / 代理」里填这套出口的对外参数（服务器 / 端口 / 身份码）即可对接。

> 客户端安装包从 [Releases](../../releases) 下载分发给成员；应用内置自动更新，机制与自建更新源见[从源码构建 / 开发](#-从源码构建--开发)。

## 👩‍💻 从源码构建 / 开发

**环境**：Node.js 18+、npm。

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

**发布新版本 / 自建更新源**（维护者 / fork）：应用以 **GitHub Releases** 为自动更新源（参考 [cc-switch](https://github.com/farion1231/cc-switch)，不经过任何自建服务器；Windows 用 NSIS + [electron-updater](https://www.electron.build/auto-update) 原地无感更新）。

1. 改 `package.json` 版本号 → 构建上面的 `dist:win:sender`（产出 NSIS 安装包与自动更新清单 `latest.yml`）与 `dist:mac:sender`（产出 `.dmg`）。
2. 在自己的 GitHub 仓库建 Release（tag `v<版本号>`），上传 `.exe`、**`latest.yml`（Windows 自动更新必需）**、`.dmg`；可用 `gh release create` 或 electron-builder `--publish`。
3. 更新源由 `package.json` 的 `homepage` / `repository` 决定——fork 后改成你自己的仓库即可。macOS 未做 Apple 签名时为下载安装包方式。

**目录结构**

```
src/                  主程序源码（main/ 主进程，renderer-next/ 新版界面）
admin_console/        独立管理端（ui/ 是 React 源码）
collab_server2/       协作服务端源码（Node http + ws）
scripts/              构建前二进制准备脚本
build/                打包资源（图标、bin/ 放第三方二进制）
```

**技术栈**：Electron 31（Chromium 126）· electron-vite · React 19 · TypeScript · Tailwind v4 · shadcn/ui · Zustand；代理基于 sing-box；服务端为纯 Node http/ws。

> 架构图与端间协议详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 🤝 欢迎参与

- 觉得有用就点个 ⭐，欢迎在 **AGPL-3.0** 下使用与二次开发（衍生作品需保持同等开源）。
- 用着不顺、有想法、发现 Bug —— 欢迎提 [Issue](../../issues)。
- 贡献代码：Fork → 改 → 提 PR，写清楚改了什么、为什么；提交前在渲染层与管理端目录跑 `npx tsc -b` 确保类型检查通过。

## 📄 免责声明（再次强调）

本项目按"**现状（AS IS）**"提供，**仅供技术学习与研究**，不构成任何明示或暗示的担保（包括但不限于适用性、可用性、不侵权）。

- 使用本项目访问第三方 AI 服务**可能违反其服务条款**，由此产生的**账号封禁、服务中断、数据丢失及任何直接/间接损失，由使用者自行承担**，作者不负任何责任。
- 本项目的网络代理能力**仅可在符合所在国家/地区法律法规的前提下使用**，**严禁用于任何非法用途**。
- 本项目与任何第三方厂商**无隶属或背书关系**。
- 你应在合理评估风险后自行决定是否使用，并对自己的使用行为负责。

## 📜 许可证

本项目以 [GNU AGPL-3.0](LICENSE) 开源。要点：

- **强 copyleft**：分发衍生作品、或将修改版作为网络服务对外提供时，须以 **AGPL-3.0** 公开完整源码，并保留版权与许可证声明。
- 软件按「现状」提供，不含任何担保（见 [免责声明](#-免责声明再次强调)）。

完整条款见 [LICENSE](LICENSE)。
