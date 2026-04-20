# ChatPortal X1 V4

ChatPortal X1 V4 是一个桌面客户端，集成了联系人聊天、房间消息和内置 ChatGPT / Gemini 网页，并提供 Sender / Receiver 两种运行模式。

这个目录是独立的 V4 工程，使用单独的应用标识、打包产物名和用户数据目录，可与 `v3_electron` 并行开发和运行。

项目交接与当前能力总览：

- `PROJECT_HANDOFF.md`

## 功能
- Sender / Receiver 双模式
- 账号登录、联系人列表、私聊、房间消息
- 图片与文件消息
- 本地聊天记录保存
- 离线后重新上线自动补同步历史消息
- 撤回自己发送的消息
- 应用内提醒、系统通知、提示铃声
- 内置 ChatGPT / Gemini 网页
- AI 使用统计
- 首次启动配置引导
- 首次登录后从服务端自动下发 Sender 连接配置
- 应用内检查、下载并打开新版本安装包
- 独立管理端，用于用户、配置和版本发布管理
- Windows 便携打包

## 下载
发行版发布位置：

```text
https://github.com/Sjeary/singbox-client/releases
```

常用发行文件：
- `chatportal-x1-v4-sender-<version>.exe`
- `chatportal-x1-v4-receiver-<version>.exe`
- `chatportal-x1-v4-<version>.exe`
- `chatportal-x1-v4-sender-<version>-arm64.dmg`
- `chatportal-x1-v4-sender-<version>-arm64.zip`

## Windows 使用
### Sender
1. 下载 `chatportal-x1-v4-sender-<version>.exe`
2. 运行程序
3. 登录账号
4. 填写连接设置并启动发送服务
5. 使用联系人聊天或内置 ChatGPT 网页
6. 可切换到内置 Gemini 网页
7. Sender 的设置、聊天记录、账号资料和 AI 网页登录状态会自动保存在系统用户目录，覆盖安装新版本后会继续保留

首次登录说明：
- 用户只需要填写协作服务地址、账号和密码
- 登录成功后，客户端会向服务端请求 Sender 默认连接配置
- 服务端返回有效配置后，客户端会自动写入本机设置，用户不需要手动导入配置文件
- 本机已经保存过的用户自定义配置不会被无提示覆盖

### Receiver
1. 下载 `chatportal-x1-v4-receiver-<version>.exe`
2. 运行程序
3. 填写接收端设置
4. 启动接收服务

## 主要页面
### Sender
- `连接设置`
- `运行记录`
- `账号与信息`
- `ChatGPT 网页`
- `Gemini 网页`
- `联系人与聊天`
- `AI 使用统计`

未登录时只显示登录页。

### Receiver
- `接收端设置`
- `运行记录`

## 聊天与资料持久化
- Sender 的设置、本地聊天记录、账号资料和 AI 网页会话保存在系统用户目录中，不保存在应用包本体内
- 当前用户数据目录固定为 `ShareGPT`，避免因为安装包名称变化导致数据目录漂移
- 启动时会兼容迁移旧应用名目录中尚未复制的数据，不覆盖当前目录已有数据
- Windows 数据目录：`%APPDATA%\ShareGPT`
- macOS 数据目录：`~/Library/Application Support/ShareGPT`
- ChatGPT 会话使用 `persist:gpt-chat`，Gemini 会话使用 `persist:gemini-chat`
- macOS 将新版本拖到“应用程序”目录覆盖旧版本时，本地数据仍会继续保留
- Windows 便携版或安装包覆盖更新时，本地数据同样会继续保留
- 打开新版本安装包前会自动生成更新前资料快照，默认保留最近 5 份
- 更新前资料快照目录：Windows `%APPDATA%\ShareGPT Backups`，macOS `~/Library/Application Support/ShareGPT Backups`
- 如果更新后用户数据目录缺失，启动时会从最近一次快照中自动恢复缺失的设置、聊天记录和 AI 网页会话目录
- 可在“账号与信息”页面导出或导入本机资料包，用于换机、迁移和手动备份

## 应用更新
- 客户端会从协作服务端获取当前可用版本信息
- 用户可以在“账号与信息”页面下载并打开新版本安装包
- Windows 会打开下载后的 `.exe`，macOS 会打开下载后的 `.dmg` 或 `.zip`
- 更新包会保存到系统“下载”目录下的 `ShareGPT Updates/<version>/`，文件名带下载时间，便于直接找到并区分新旧版本
- 当前实现是“辅助更新”：负责检查、下载和打开安装包，不会静默替换正在运行的程序
- 更新后继续读取同一个 `ShareGPT` 用户数据目录，因此账号、聊天、配置、ChatGPT 登录状态和 Gemini 登录状态会保留
- 打开安装包前会刷新 ChatGPT / Gemini 持久会话数据并生成更新前快照；快照失败时不会继续打开安装包
- 安装包打开成功后，当前程序会自动退出，避免旧程序占用文件导致覆盖安装失败
- 如果未来需要完全静默自动更新，应切换到签名安装包和 `electron-updater` 方案

## 内置 ChatGPT 网页
- 使用 Electron 内嵌 Chromium 打开 ChatGPT
- V4 使用主进程 `WebContentsView` 挂载页面
- 通过本地 `sing-box` 代理访问
- 切换页面后尽量保留原来的会话位置
- 支持前进、后退、刷新、全屏和浏览器打开

## 内置 Gemini 网页
- 使用 Electron 内嵌 Chromium 打开 Gemini
- V4 使用主进程 `WebContentsView` 挂载页面
- 通过与 ChatGPT 相同的本地 `sing-box` 代理访问
- 使用独立持久会话分区保存 Google 登录状态
- 支持前进、后退、刷新、全屏和浏览器打开

## Windows 打包
### 统一便携包
```bash
npm run dist:win
```

### Sender 单独分发
```bash
npm run dist:win:sender
```

### Receiver 单独分发
```bash
npm run dist:win:receiver
```

### 同时打包 Sender 和 Receiver
```bash
npm run dist:win:split
```

也可以直接使用这些脚本：
- `build_win_portable.bat`
- `build_win_sender.bat`
- `build_win_receiver.bat`
- `build_win_split.bat`

默认输出目录：
- `release/`
- `release_sender/`
- `release_receiver/`

GitHub Release 文件：
- `release_sender/chatportal-x1-v4-sender-<version>.exe`
- `release_receiver/chatportal-x1-v4-receiver-<version>.exe`
- `release/chatportal-x1-v4-<version>.exe`

## macOS 打包
当前只支持 Sender。

前提：
- macOS
- Node.js 20+
- Apple Silicon

命令：

```bash
npm run dist:mac:sender
```

或：

```bash
./build_mac_sender.sh
```

输出目录：
- `release_sender/`

常用发行文件：
- `release_sender/chatportal-x1-v4-sender-<version>-arm64.dmg`
- `release_sender/chatportal-x1-v4-sender-<version>-arm64.zip`

说明：
- macOS 版本不包含 Receiver
- macOS Sender 不要求 `frpc`
- 仓库内已放置 macOS 所需的 `sing-box`
- `build_mac_sender.sh` 会自动补充常见 Homebrew Node 路径，并把 Electron 缓存写到仓库内 `.cache/`

## 运行环境
- Node.js 20+
- npm 10+ 推荐
- Windows 优先
- macOS 当前以 Sender 构建和运行为主

## 从源码运行
### 安装依赖
```bash
npm install
```

## 本地私有配置
本地调试配置文件：

- `private.defaults.local.json`

该文件不纳入 Git 版本控制。

模板文件：

- `private.defaults.local.example.json`

使用方法：
1. 复制 `private.defaults.local.example.json`
2. 重命名为 `private.defaults.local.json`
3. 填入服务器地址、端口、UUID 和账号

程序启动时优先读取本地文件，再读取用户目录中的运行设置。
如果没有检测到本地私有配置，程序会在用户目录自动生成一个可编辑模板。

## 二进制资源

项目运行依赖 `sing-box`，Receiver 还需要 `frpc`。

默认查找位置：

- `build/bin/`
- `build/bin/<platform>/`

可选环境变量：

- `CHATPORTAL_BIN_DIR`
- `CHATPORTAL_SINGBOX_PATH`
- `CHATPORTAL_FRPC_PATH`

说明：

- 启动和打包脚本不再依赖仓库外层的固定目录结构
- 开发环境和分发环境都优先使用仓库内或显式指定的二进制路径

### 本地运行
```bash
npm run dev
```

### Sender
```bash
npm run dev:sender
```

### Receiver
```bash
npm run dev:receiver
```

## 仓库内容
- `src/`
  - Electron 主进程、预加载脚本、页面和样式
- `build/bin/`
  - 运行依赖二进制
  - 包含 Windows 所需二进制和 macOS Sender 所需 `sing-box`
- `scripts/prepare-assets.mjs`
  - 启动和打包前整理运行资源
- `collab_server2/`
  - 登录、聊天、在线状态和 AI 使用统计服务端
- `admin_console/`
  - 独立管理端，可在 Windows 和 macOS 打开

## 管理端
管理端是独立桌面程序，源码位于：

- `admin_console/`

能力：
- 管理员登录和首次管理员初始化
- 查看用户、创建用户、修改用户信息
- 维护首次登录自动下发的 Sender 配置
- 上传 Windows / macOS 新版本安装包
- 保存服务端备用扩展配置

从根目录启动：

```bash
npm run dev:admin
```

从根目录打包：

```bash
npm run dist:admin:win
npm run dist:admin:mac
```

也可以进入子目录单独运行：

```bash
cd admin_console
npm install
npm run dev
```

## 协作服务端
快速启动：

```bash
cd collab_server2
npm install
node add_user.js admin MyStrongPass123 --admin
npm start
```

客户端服务地址示例：

```text
http://server.example.com:8088
```

部署说明：
- `collab_server2/README.md`

服务端运行数据：
- `collab_server2/data/users.json`
- `collab_server2/data/chat_history.json`
- `collab_server2/data/gpt_usage.json`
- `collab_server2/data/client_bootstrap.json`
- `collab_server2/data/releases/`

这些数据目录不纳入 Git。生产环境部署时应单独备份。

## Git
克隆仓库：

```bash
git clone git@github.com:Sjeary/singbox-client.git
cd singbox-client
```

查看状态：

```bash
git status
```

提交：

```bash
git add .
git commit -m "your message"
```

推送：

```bash
git push
```

## 仓库说明
- 仓库中保留源码、构建配置和运行所需二进制
- `node_modules/`、`release*/`、服务端运行数据、管理端构建产物不会进入 Git


