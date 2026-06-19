<div align="center">

# ShareGPT 桌面客户端

**把 ChatGPT / Claude / Gemini「装进一个客户端」，由管理员统一配置网络，面向团队/小组协作使用的跨平台桌面应用。**

_A cross-platform desktop app that embeds ChatGPT / Claude / Gemini, routes them through an admin-managed proxy, and adds team chat — so a whole group can use AI without each person fighting the network._

![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)
![electron](https://img.shields.io/badge/Electron-31-47848F)
![license](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-green)

</div>

---

## 为什么做这个（痛点）

团队里常常很多人都要用 ChatGPT / Claude / Gemini，但现实里到处是坎：

- **每个人各自折腾网络/梯子**：配置门槛高、节点不稳、续费分散，非技术成员根本搞不定。
- **网页登录在受限网络下不稳**：动不动卡在 Cloudflare 人机验证、白屏、反复掉登录态（Claude 尤其难搞）。
- **没法统一管理**：谁在用、用了多少、配置怎么下发、出了问题怎么收集反馈——全靠手工。
- **缺少"用 AI + 一起协作"的一体化工具**：开着浏览器用 AI，又要另开工具沟通。

ShareGPT 就是为了把这些一次性解决：**装上、登录、即用**；网络和配置由管理员集中下发；同时内置团队协作、用量统计和统一后台。

## 这是什么

一个 Electron 桌面客户端 + 一套轻量协作服务端 + 一个独立管理控制台：

- **客户端**：内嵌三家 AI 网页（多标签、各自独立会话、登录态持久化），把 AI 站点的流量按域名清单走代理；内置团队协作聊天与用量统计。
- **协作服务端**（`collab_server2/`）：纯 Node.js 的 http + WebSocket，负责账号、聊天、配置下发、版本分发。零外部依赖、可多实例（多群）。
- **管理控制台**（`admin_console/`）：管理员用来管用户、下发代理配置、查看反馈、发布版本。

## ✨ 功能特性

- **AI 工作区**：内嵌 ChatGPT / Claude / Gemini（可在设置里开关入口），多标签同构，明暗主题跟随，沉浸/全屏（F11）。
- **代理转发（基于 [sing-box](https://sing-box.sagernet.org/)）**：
  - 管理员统一下发连接配置，成员**首登自动拉取**，无需手配。
  - 只对 AI 站点**按内置域名清单**走代理，其余直连/走本机代理。
  - **代理检测**：实时显示页面流量是否全部走代理；发现"会用到却没走代理"的域名时**自动加入本机清单并上报管理员**，一键重启即时生效。
  - **可选「机场订阅」模式**：管理员粘贴 Clash 订阅、选一个节点下发，客户端可选择走机场节点（与统一代理并存，默认统一）。
- **协作聊天**：私聊 / 房间消息、图片与文件、撤回 / 已读 / 回复 / 转发、离线补同步、可自定义提醒；管理员可禁止某人使用聊天。
- **使用统计**：按 ChatGPT / Gemini / Claude 维度统计每人查询量与排行。
- **管理控制台**：用户增删改、Sender 默认配置下发、机场节点下发、用户反馈查看、"漏走代理域名"汇总、版本发布。
- **应用内更新**：从协作服务器拉取最新版本、下载安装、保留账号/聊天记录/网页登录态；登录页有"发现新版本"提醒。
- **跨平台**：Windows 与 macOS（Apple Silicon）。

## 🚀 快速开始（普通用户）

1. 到 [Releases](../../releases) 下载对应平台安装包（Windows `.exe` / macOS `.dmg`）。
2. 打开应用，**登录**管理员给你的账号（服务地址 + 账号 + 密码）；或在登录页「导入配置」导入管理员发的配置文件。
3. 首次登录会自动拉取代理配置。进入「发送端设置」，点击**开启发送服务**。
4. 左侧导航打开 **ChatGPT / Claude**，即可使用；用「协作聊天」与同组成员沟通。

> **macOS 提示**：安装包未做苹果签名，首次打开请**右键 →「打开」**，或在终端执行
> `xattr -dr com.apple.quarantine "/Applications/ShareGPT Sender.app"`。

## 🛠️ 管理员 / 部署指南

整套由三部分组成：**协作服务端** + **管理控制台** + 给用户的**客户端安装包**。

### 1. 部署协作服务端

源码在 [`collab_server2/`](collab_server2/)，是零外部依赖的 Node.js 服务（http + ws）。直接 `node server.js` 即可，用**环境变量**配置：

| 环境变量 | 说明 | 默认 |
| --- | --- | --- |
| `PORT` | 监听端口 | `8088` |
| `USERS_FILE` | 用户库 JSON 路径 | `data/users.json` |
| `CHAT_HISTORY_FILE` | 聊天记录路径 | `data/chat_history.json` |
| `GPT_USAGE_FILE` | 使用统计存储路径（同目录还会放 `gemini_usage.json` / `claude_usage.json` / `feedback.json` / `proxy_missing.json` / `airport.json`） | `data/gpt_usage.json` |
| `CLIENT_BOOTSTRAP_FILE` | 下发给客户端的默认配置（Sender / update / 机场节点） | `data/client_bootstrap.json` |
| `RELEASES_DIR` / `RELEASE_STORE` | 版本安装包目录 | `data/releases` / `release_shared` |
| `DEV_TOKEN` | 开发者全局发布密钥（留空则关闭该入口） | — |

> 想做"多群"，只要为每个实例指定**不同的数据目录**（不同的 `*_FILE` / `RELEASES_DIR`）和 `PORT` 即可，可用 systemd 等托管。**请用你自己的密钥/账号，切勿使用任何示例值。**

### 2. 用管理控制台

[`admin_console/`](admin_console/) 是独立的 Electron 管理端。构建便携包：`npm run dist:admin:win`。登录后可以：

- **用户管理**：新增/编辑/禁用账号、设管理员、禁用某人协作聊天。
- **Sender 配置**：填一份默认连接配置，新用户首登自动拉取。
- **机场代理**（可选）：粘贴 Clash 订阅 → 选一个节点 → 自动转成 sing-box 出站下发给本群。
- **反馈 / 漏走代理域名**：查看用户反馈、客户端上报的待补域名。
- **版本发布**：上传安装包与更新说明。

### 3. 发布版本

把打好的安装包放进服务端的共享发布库目录、写入 `release.json`（含版本号与 Win/Mac 文件名），客户端"检查更新"即可拉到并安装。

## 👩‍💻 从源码构建 / 开发

**环境**：Node.js 18+、npm。

```bash
# 安装依赖（主程序 + 渲染层 + 管理端）
npm install
npm --prefix src/renderer-next install
npm --prefix admin_console/ui install

# 准备第三方二进制（sing-box，必要时还有 frpc），按 build/bin/README.md 放好
# 然后打包：
npm run dist:win:sender     # Windows 发送端
npm run dist:mac:sender     # macOS 发送端（自动先编译渲染层）
npm run dist:admin:win      # 管理控制台
```

**目录结构**

```
src/                  主程序源码（main/ 主进程，renderer-next/ 新版界面）
admin_console/        独立管理端（ui/ 是 React 源码）
collab_server2/       协作服务端源码（Node http + ws）
scripts/              构建前二进制准备脚本
build/                打包资源（图标、bin/ 放第三方二进制）
build.sender.json     发送端打包配置
build.receiver.json   接收端打包配置
```

**技术栈**：Electron 31（Chromium 126）· electron-vite · React 19 · TypeScript · Tailwind v4 · shadcn/ui · Zustand；代理基于 sing-box；服务端为纯 Node http/ws。

## 🤝 欢迎参与

- 觉得有用就点个 ⭐，也欢迎拿去**非商业地**尝试、二次开发。
- 用着不顺、有想法、发现 Bug —— 欢迎提 [Issue](../../issues)。
- 想贡献代码：Fork → 改 → 提 PR，描述清楚改了什么、为什么。提交前请在渲染层与管理端各自目录跑 `npx tsc -b` 确保类型检查通过。

## 📄 许可证

本项目采用 **[PolyForm Noncommercial License 1.0.0](LICENSE)**：

- ✅ 允许**个人 / 非商业**地使用、修改、**转载与分发**（转载时需保留版权声明与本许可证）。
- ✅ 允许学习、研究、爱好项目、非营利组织等非商业用途。
- ❌ **禁止任何商业用途**（包括但不限于售卖、商用部署、商业增值服务）。

如需商业授权，请联系作者另行约定。完整条款见 [LICENSE](LICENSE)。

## ⚠️ 免责声明

本项目仅供学习与**非商业**用途。使用者须自行遵守所在地法律法规，以及 OpenAI / Anthropic / Google 等各 AI 服务的使用条款；代理/网络功能请在合规前提下使用。作者不对使用本软件产生的任何后果负责。本仓库与上述厂商无任何隶属或背书关系。
