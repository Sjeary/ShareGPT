# ShareGPT

ShareGPT 是一个 Electron 桌面客户端，集成了联系人聊天、房间消息、内置 ChatGPT / Gemini 网页，以及 Sender / Receiver 两种运行模式。

这个仓库现在只保留最小可用源码、构建配置和必要文档：

- 不再提交第三方二进制
- 不再提交本地启动脚本、打包辅助脚本、临时压缩包和交接过程文档
- 克隆后可以直接安装依赖并编译

## 主要能力
- Sender / Receiver 双模式
- 账号登录、联系人、私聊、房间消息
- 图片与文件消息
- 本地聊天记录与资料持久化
- 离线消息补同步、撤回、自定义提醒
- 内置 ChatGPT / Gemini 工作区
- 首次登录后自动拉取 Sender 默认配置
- 应用内检查更新、下载并打开安装包
- 独立管理端 `admin_console/`

## 仓库结构
- `src/`：主程序源码
- `admin_console/`：独立管理端源码
- `collab_server2/`：协作服务端源码
- `scripts/prepare-assets.mjs`：构建前二进制准备脚本
- `build.sender.json`：Sender 打包配置
- `build.receiver.json`：Receiver 打包配置
- `private.defaults.local.example.json`：本地私有配置模板
- `build/bin/README.md`：第三方二进制准备说明

## 环境要求
- Node.js 20+
- npm 10+ 推荐
- Windows 或 macOS

## 安装依赖
```bash
npm install
```

## 从源码运行
### 主程序
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

### 管理端
```bash
npm run dev:admin
```

## 打包
### Windows
```bash
npm run dist:win
npm run dist:win:sender
npm run dist:win:receiver
npm run dist:win:split
```

### macOS
```bash
npm run dist:mac
npm run dist:mac:sender
npm run dist:admin:mac
```

常用发行文件名：
- `sharegpt-<version>.exe`
- `sharegpt-sender-<version>.exe`
- `sharegpt-receiver-<version>.exe`
- `sharegpt-sender-<version>-arm64.dmg`
- `sharegpt-admin-<version>.exe`

## 第三方二进制

仓库不再内置 `sing-box` 或 `frpc`。这样 Git 历史更干净，也不会把第三方可执行文件直接提交进源码仓库。

### 这意味着什么
- 你仍然可以直接克隆、安装依赖、运行界面、打包应用
- 只有在真正启动 Sender / Receiver 代理服务时，才需要先准备对应二进制

### 准备方式
请查看：

- `build/bin/README.md`

支持两种方式：
- 把官方二进制放到 `build/bin/` 或 `build/bin/<platform>/`
- 通过环境变量指定已有二进制路径

支持的环境变量：
- `SHAREGPT_BIN_DIR`
- `SHAREGPT_SINGBOX_PATH`
- `SHAREGPT_FRPC_PATH`

## 本地私有配置
- 本地私有配置文件：`private.defaults.local.json`
- 示例模板：`private.defaults.local.example.json`

这个文件不会提交到 Git。程序启动时优先读取本地私有配置，再读取用户目录中的运行设置。

## 数据持久化
- 用户数据目录固定为 `ShareGPT`
- Windows：`%APPDATA%\\ShareGPT`
- macOS：`~/Library/Application Support/ShareGPT`
- ChatGPT 会话分区：`persist:gpt-chat`
- Gemini 会话分区：`persist:gemini-chat`

更新后会继续使用同一个用户数据目录，因此以下内容会保留：
- 登录账号
- 聊天记录
- Sender 配置
- 主题与提醒设置
- ChatGPT / Gemini 登录状态

## 应用更新
- 客户端会从协作服务端获取版本信息
- 点击“下载并更新”后，会把安装包保存到系统下载目录中的 `ShareGPT Updates/<version>/`
- 打开安装包前会自动生成更新前快照
- 打开安装包成功后，当前程序会自动退出，避免覆盖安装失败

## 首次登录自动配置
- 用户只需要填写协作服务地址、账号和密码
- 登录成功后会自动请求服务器下发 Sender 默认配置
- 服务端配置存在时，客户端会自动写入本地 Sender 设置
- 已有完整本机配置不会被静默覆盖

## 管理端
独立管理端位于 `admin_console/`，用于：
- 用户管理
- Sender 默认配置下发
- 版本上传与发布
- 备用配置管理

## 服务端
协作服务端位于 `collab_server2/`，用于：
- 登录认证
- 在线状态同步
- 聊天消息与历史同步
- 更新信息分发
- 管理员接口

