# ChatPortal X1 V4 协作服务

这个目录提供 ChatPortal X1 V4 所需的服务端能力，用于处理登录认证、在线状态、联系人列表、实时聊天和 AI 使用统计。

## 功能
- 账号密码登录
- 在线成员同步
- WebSocket 实时聊天
- 房间消息和私聊
- 昵称、头像、资料同步
- AI 使用次数统计
- 首次登录自动下发 Sender 默认配置
- 客户端版本更新信息下发
- 管理员接口（用户、默认配置、版本发布）

## 环境要求
- Node.js 20+

## 安装
```bash
npm install
```

## 创建账号
```bash
node add_user.js <username> <password>
```

可选头像：
```bash
node add_user.js <username> <password> "🙂"
```

示例：
```bash
node add_user.js admin MyStrongPass123
```

创建管理员账号：

```bash
node add_user.js admin MyStrongPass123 --admin
```

## 启动
```bash
npm start
```

默认监听：

```text
0.0.0.0:8088
```

## 环境变量
- `PORT`：监听端口，默认 `8088`
- `HOST`：监听地址，默认 `0.0.0.0`
- `USERS_FILE`：用户文件路径，默认 `./data/users.json`
- `GPT_USAGE_FILE`：AI 统计文件路径，默认 `./data/gpt_usage.json`
- `SESSION_TTL_MS`：会话有效期，默认 24 小时
- `HISTORY_MAX`：聊天历史缓存上限，默认 `200`
- `GPT_USAGE_MAX`：AI 统计记录上限，默认 `50000`
- `CLIENT_BOOTSTRAP_FILE`：客户端默认配置文件路径，默认 `./data/client_bootstrap.json`

## Sender 默认配置来源

管理端和客户端读取的 Sender 默认配置来自 `data/client_bootstrap.json`。

如果该文件还没有填写完整，服务端会使用下面的环境变量提供服务器侧建议值：

- `CHATPORTAL_SENDER_PROXY_SERVER`
- `CHATPORTAL_SENDER_PROXY_PORT`
- `CHATPORTAL_SENDER_PROXY_UUID`
- `CHATPORTAL_SENDER_SOCKS_PORT`
- `CHATPORTAL_SENDER_FALLBACK_MODE`
- `CHATPORTAL_SENDER_FALLBACK_LOCAL_PORT`
- `CHATPORTAL_SENDER_TARGET_DOMAINS`

兼容短名称：

- `SENDER_PROXY_SERVER`
- `SENDER_PROXY_PORT`
- `SENDER_PROXY_UUID`
- `SENDER_SOCKS_PORT`
- `SENDER_FALLBACK_MODE`
- `SENDER_FALLBACK_LOCAL_PORT`
- `SENDER_TARGET_DOMAINS`

如果没有设置 `*_PROXY_SERVER`，服务端会使用当前管理端访问请求的 Host 作为服务器地址候选。管理员在管理端保存后，最终配置会写入 `data/client_bootstrap.json`。

## 与客户端对接
在 ChatPortal X1 V4 中填写：
- 服务地址：`http://server.example.com:8088`
- 账号：通过 `add_user.js` 创建
- 密码：创建时设置

登录成功后会自动建立消息连接。

## Ubuntu 部署
部署目录：整个 `collab_server/` 目录。

一键部署：

```bash
cd /root/collab_server
chmod +x deploy_ubuntu.sh
sudo ./deploy_ubuntu.sh
```

默认部署目录：

```text
/opt/chatportal-x1-v4-collab
```

部署后创建账号：

```bash
cd /opt/chatportal-x1-v4-collab
sudo -u chatportal node add_user.js <user> <password>
```

## 手工部署示例
```bash
sudo apt-get update
sudo apt-get install -y nodejs npm
cd /opt/chatportal-x1-v4-collab
npm install --omit=dev
node add_user.js <user> <password>
npm start
```

## 数据文件
运行时会使用：
- `data/users.json`
- `data/gpt_usage.json`
- `data/chat_history.json`
- `data/client_bootstrap.json`
- `data/releases/`

这些文件不纳入 Git 版本控制。

## 管理端

配合独立的 `../admin_console/` 使用时，可以直接完成：

- 查看和编辑用户
- 创建用户
- 保存首次登录自动下发的 Sender 配置
- 上传 Windows / macOS 安装包
- 发布更新说明和版本号

管理端启动：

```bash
cd ../admin_console
npm install
npm run dev
```

上传的安装包会保存到：

```text
data/releases/
```

客户端检查更新时会读取 `data/client_bootstrap.json` 中的 `updates` 字段，并从 `/downloads/<file>` 下载对应安装包。


