<div align="center">

# ShareGPT 桌面客户端

**把 ChatGPT、Claude、Gemini、翻译、知识管理与团队协作放进一个客户端；既可独立在本机使用，也可连接自托管团队。**

_A cross-platform desktop workspace for embedded AI, translation, personal productivity, private networking, and self-hosted collaboration._

[![CI](https://github.com/Sjeary/ShareGPT/actions/workflows/ci.yml/badge.svg)](https://github.com/Sjeary/ShareGPT/actions/workflows/ci.yml)
[![version](https://img.shields.io/github/v/release/Sjeary/ShareGPT)](https://github.com/Sjeary/ShareGPT/releases)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)
![electron](https://img.shields.io/badge/Electron-43.1.0-47848F)
![react](https://img.shields.io/badge/React-19-61DAFB)
[![license](https://img.shields.io/github/license/Sjeary/ShareGPT)](LICENSE)

</div>

---

## 简介

ShareGPT 是一个面向 AI 网页使用、个人知识管理和小团队协作的桌面工作区。它提供两种彼此隔离的使用方式：个人工作区无需团队账号，代理、翻译接口和 AI 网页登录状态只保存在本机；团队工作区连接你或组织自托管的协作服务器，由管理员统一下发网络与翻译配置，并提供聊天、共享日历、权限和用量管理。

两种工作区可以随时切换，分别保留自己的设置、AI 网页登录状态和历史会话。

整套由三部分组成：

- **桌面客户端**：内嵌三家 AI 网页，并提供翻译、日历、待办、知识库、专注工具、个人网络配置和可选的团队协作。
- **协作服务端**（`collab_server2/`）：Node.js `http` + `ws` 服务，负责账号、聊天、权限、配置和用量数据；可按团队运行独立实例。
- **管理控制台**（`admin_console/`）：管理用户、代理线路、各 AI 默认线路、托管翻译、授权和用量统计。

版本变化见 [CHANGELOG.md](CHANGELOG.md)，从零部署团队服务见 [自托管完整教程](docs/SELF_HOSTING.md)，端间职责与数据边界见 [架构总览](docs/ARCHITECTURE.md)。正式可下载版本始终以 [GitHub Releases](../../releases) 为准。

### 两种工作区怎么选

| 能力                      | 个人工作区                        | 团队工作区                                                 |
| ------------------------- | --------------------------------- | ---------------------------------------------------------- |
| 进入方式                  | 无需 ShareGPT 团队账号            | 登录自托管协作服务器                                       |
| ChatGPT / Claude / Gemini | 独立的本机网页分区                | 独立于个人工作区的组织网页分区                             |
| 网络                      | 按需使用自己的 HTTP / SOCKS5 代理 | 普通成员自动使用管理员下发配置；获授权的高级用户可选择线路 |
| 翻译                      | 自己配置 API 或本地离线服务       | 可使用个人配置，也可选择管理员授权的托管服务               |
| 日历、待办、笔记、专注    | 本机使用                          | 本机使用，并可获得相应的团队同步或排行能力                 |
| 聊天、在线成员、团队日历  | 不显示                            | 可用，具体能力受管理员权限控制                             |
| 团队用量与管理            | 不显示                            | 成员查看获准数据；管理员通过独立控制台管理                 |
| 数据清理                  | 按服务确认后清理个人网页分区      | 重新验证团队账号后清理当前组织网页分区                     |

## ✨ 功能特性

### AI、翻译与网络

- **AI 工作区**：内嵌 ChatGPT / Claude / Gemini，可在设置中隐藏暂时不用的入口。网页标签和登录状态保存在稳定分区中；切换页面、工作区或窗口状态时复用健康页面，避免不必要的刷新和重新登录。
- **多环境与明确线路**：团队管理员默认拥有高级 AI 能力；获授权的高级用户可为同一 AI 建立多个独立登录环境，并分别选择可用线路。
- **翻译工作台**：区分“阅读翻译”和“写给 AI”。支持手动输入、网页选区和整页读取；阅读译文可直接复制，写给 AI 则先预览，再追加或替换网页草稿。
- **可控翻译任务**：支持自然、直译、简洁三种风格、术语表、自动选区翻译和可选发送提醒，翻译过程中可随时停止。侧栏支持拖动调宽、双击复位，并适配窄窗口。
- **个人或团队翻译服务**：个人用户可配置 OpenAI 兼容接口、通用翻译接口或本地离线服务；团队成员还可选择管理员授权的托管配置。团队 API Key 只保存在服务器密文中，不下发客户端。
- **网络 / 代理（基于 [sing-box](https://sing-box.sagernet.org/)）**：
  - 个人工作区可使用自己的 HTTP 或 SOCKS5 代理；团队普通成员自动同步管理员配置，无需查看连接凭据和内部端口。
  - 管理员可分别为 ChatGPT、Gemini 和 Claude 推荐默认线路；高级用户可在自己获授权的线路中调整多个 AI 环境。
  - 只对 AI 站点**按内置域名清单**走代理，其余直连/走本机代理。
  - **代理检测**：检查 AI 页面是否绑定到预期线路；线路或出口校验失败时停止导航，不静默切换出口。

### 日历、待办、知识库与专注

- **个人日历**：月、周、日视图管理多个日历和重复事件，支持导入 `.ics`；登录团队后可把事件共享到组队日历。
- **备忘录 / 待办**：清单、智能视图和便签集中管理，支持自然语言快速添加、到期提醒，以及单条或批量同步到个人日历。
- **笔记 / 知识库**：使用本地 Markdown 文件夹，支持新建知识库、导入或直接打开 Obsidian 类仓库；提供 `[[双链]]`、反链、关系图谱、全文检索、Canvas 白板、表格视图和快捷命令。
- **Notes AI**：支持笔记扩写、润色、内联改写、问答和自动建立知识关联，个人与团队分别保存自己的 AI 配置。
- **同步与冲突保护**：个人日历、待办和笔记以本地数据为基础；连接团队后可使用对应的云端同步，并展示拉取、自动合并、冲突保留和删除等对比结果。
- **专注 / 番茄钟**：支持计时、绑定待办、白噪音和个人统计；连接支持该能力的团队服务器后，还可查看团队专注排名。

### 团队协作与管理

- **协作聊天**：支持房间消息和私聊、图片与文件、回复、转发、撤回、已读、表情回应及离线补同步；成员列表持续显示在线人数和总人数。消息提示可直接跳到对应会话和消息。
- **组队日历**：共享团队事件、邀请成员并收集接受 / 拒绝 / 待定回应，可按成员筛选日程。
- **通知控制**：消息弹窗、提示音、系统通知和成员上线提醒默认保持安静，可在账户页分别开启；应用内提示位于右上角，不遮挡主要操作。
- **用量统计**：查看 AI 网页成功发送的消息数；托管翻译可按用户和配置统计请求、字符、token 与估算费用。
- **管理控制台**：集中维护用户和聊天权限、高级 AI 权限、多线路授权、各 AI 推荐线路、加密托管翻译配置、使用量和版本信息。普通成员只接收最终可用配置，不需要理解或修改内部节点凭据。

### 数据、界面与更新

- **网页隐私与环境**：可分别清理或重建 ChatGPT / Gemini / Claude 的网页登录数据；支持与代理出口一致的语言、时区和可选粗略位置，并阻止 WebRTC 非代理 UDP 泄漏。环境策略可跨设备同步，Cookie、网页历史和登录态不会上传。
- **网页可见信息检查**：可查看各 AI 页面实际感知的出口、时区、语言、WebRTC、UA、硬件和图形摘要，比较清理前后或不同设备的差异；快照只保存摘要和哈希。
- **可定制界面**：支持明暗主题、全屏、网页缩放、侧栏收起、左右换边、隐藏入口和长按拖动排序；首次进入有分步引导，也可稍后从标题栏重新打开。
- **应用内更新**：以 **GitHub Releases** 为唯一版本来源（参考 [cc-switch](https://github.com/farion1231/cc-switch)，不经过协作服务器）。Windows 支持后台下载、原地安装并重启；macOS 当前使用正式 DMG 升级。升级不会主动删除账号、设置或 AI 网页资料。
- **跨平台**：Windows x64 与 macOS Apple Silicon。

## 🚀 快速开始（普通用户）

1. 到 [Releases](../../releases) 下载对应平台的正式安装包（Windows `.exe` / macOS `.dmg`）。
2. 首次启动阅读工作区说明，然后选择“仅在本机使用”或“连接团队”。选错后可以返回，也可以稍后从“账户”切换。
3. **个人使用**：无需 ShareGPT 团队账号。按需在“网络 / 代理”填写自己的 HTTP 或 SOCKS5 代理，在翻译栏选择自己的 API 或本地翻译服务；日历、待办、笔记和专注数据可以直接在本机使用。
4. **团队使用**：填写管理员提供的 HTTPS 服务地址、用户名和密码。登录后，普通成员会自动同步获授权的网络和翻译配置；聊天、在线成员、组队日历与团队用量入口会按权限出现。
5. 打开 ChatGPT、Claude 或 Gemini，并分别完成对应网站登录。网站账号与 ShareGPT 团队账号不是同一套身份；个人和团队工作区也使用不同的网页分区。

> ShareGPT 不附带公共团队服务器、代理节点、第三方 AI 账号或翻译 API Key。个人用户使用自己的服务；团队用户从自己的管理员处获得连接信息和授权。

> 首次安装可能出现系统安全提示：1.0.9 的 Windows 安装包未签名，Mac 版未经 Apple 公证。请从本仓库 [Release 页面](../../releases/latest)下载并查看安装说明。

ShareGPT 是独立开源项目，与 OpenAI、Anthropic、Google 无隶属关系。第三方服务需使用自己的账号，并遵守相应服务条款及当地法律法规。项目采用 [GPL-3.0 许可证](LICENSE)。

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

管理员通过管理端和协作服务端维护出口参数、线路授权与各 AI 推荐线路。普通成员登录后自动接收自己获准使用的最终配置，不需要也不能查看内部连接凭据；只有管理员和获授权的高级用户可以调整相应线路。

> 客户端安装包从 [Releases](../../releases) 下载分发给成员；应用内置自动更新，机制与自建更新源见[从源码构建 / 开发](#-从源码构建--开发)。

## 👩‍💻 从源码构建 / 开发

**环境**：Node.js 22.12+、npm。

```bash
# 安装锁文件固定的依赖（主程序 + 渲染层 + 管理端 + 协作服务端）
npm ci
npm --prefix src/renderer-next ci
npm --prefix admin_console/ui ci
npm --prefix collab_server2 ci

# 准备第三方二进制（sing-box；自建出口时另需转发组件），按 build/bin/README.md 放好
# 然后打包：
npm run dist:win:sender     # Windows 客户端
npm run dist:mac:sender     # macOS 客户端（自动先编译渲染层）
npm run dist:admin:win      # 管理控制台
```

**发布与自建更新源**：应用通过 **GitHub Releases** 获取更新。维护者和 fork 项目的构建、签名及发布步骤见[发布指南](docs/RELEASING.md)。

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
- 贡献代码：Fork → 改 → 提 PR，写清楚改了什么、为什么；提交前至少运行 `npm test`、`npm run typecheck:main`、`npm run format:check`，并完成改动范围对应的构建或 Electron 验收。

## 📜 许可证

本项目以 [GNU GPL-3.0](LICENSE) 开源。要点：

- **强 copyleft**：分发衍生作品（含修改版）时，须以 **GPL-3.0** 公开完整源码，并保留版权与许可证声明。
- 软件按「现状」提供，担保范围及其他条款见 [LICENSE](LICENSE)。

完整条款见 [LICENSE](LICENSE)。
