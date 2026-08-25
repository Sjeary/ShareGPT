# ShareGPT 协作服务

这个目录提供 ShareGPT 所需的服务端能力，用于处理登录认证、在线状态、聊天同步、客户端默认配置下发和版本更新信息分发。

## 功能

- 账号密码登录
- 在线成员同步
- WebSocket 实时聊天
- 房间消息与私聊
- 头像、昵称、资料同步
- 离线消息历史补同步
- 首次登录自动下发 Sender 默认配置
- 版本信息与安装包下载地址分发
- 管理员接口

## 环境要求

- Node.js 20+

## 安装

```bash
npm install
```

## 启动

```bash
npm start
```

默认监听：

```text
0.0.0.0:8088
```

## 创建账号

```bash
node add_user.js <username> <password>
```

创建管理员账号：

```bash
node add_user.js admin MyStrongPass123 --admin
```

## 关键环境变量

- `PORT`
- `HOST`
- `USERS_FILE`
- `GPT_USAGE_FILE`
- `CHAT_HISTORY_FILE`
- `CLIENT_BOOTSTRAP_FILE`
- `PROXY_ROUTES_FILE`
- `PROXY_ROUTE_HEALTH_FILE`
- `RELEASES_DIR`
- `SESSION_TTL_MS`
- `HISTORY_MAX`
- `GPT_USAGE_MAX`

## Sender 默认配置来源

客户端和管理端读取的默认配置来自：

```text
data/client_bootstrap.json
```

如果这个文件尚未完整填写，服务端会优先读取以下环境变量作为建议值：

- `SHAREGPT_SENDER_PROXY_SERVER`
- `SHAREGPT_SENDER_PROXY_PORT`
- `SHAREGPT_SENDER_PROXY_UUID`
- `SHAREGPT_SENDER_PROXY_EXPECTED_IP`
- `SHAREGPT_SENDER_PROXY_EXPECTED_COUNTRY`
- `SHAREGPT_SENDER_PROXY_EXPECTED_ASN`
- `SHAREGPT_SENDER_SOCKS_PORT`
- `SHAREGPT_SENDER_FALLBACK_MODE`
- `SHAREGPT_SENDER_FALLBACK_LOCAL_PORT`
- `SHAREGPT_SENDER_TARGET_DOMAINS`

兼容短名称：

- `SENDER_PROXY_SERVER`
- `SENDER_PROXY_PORT`
- `SENDER_PROXY_UUID`
- `SENDER_SOCKS_PORT`
- `SENDER_FALLBACK_MODE`
- `SENDER_FALLBACK_LOCAL_PORT`
- `SENDER_TARGET_DOMAINS`

## 与客户端对接

在 ShareGPT 中填写：

- 服务地址：`http://server.example.com:8088`
- 账号：通过 `add_user.js` 创建
- 密码：创建时设置

登录成功后，客户端会自动建立消息连接并拉取默认配置与历史消息。

## 内置线路目录

管理端保存的 sing-box 线路默认位于 `data/proxy_routes.json`。服务端会对整份目录先校验、后原子写入；任何线路不合法都会拒绝整次保存，不会部分覆盖。当前接受的常见出站类型包括 `socks`、`http`、`shadowsocks`、`vmess`、`vless`、`trojan`、`hysteria2` 和 `tuic`，错误响应会指出类似 `routes[0].outbound.uuid` 的具体字段路径。

每次成功保存都会生成 `proxy_routes.json.backup-*`，最多保留最近 10 份。主目录出现 JSON 或 schema 损坏时会被改名为 `proxy_routes.json.corrupt-*`，随后恢复最近的有效备份；没有有效备份时接口会显式失败，避免静默下发空线路。主目录不存在时仍兼容旧版 `airport.json`。

## Ubuntu 部署

一键部署：

```bash
chmod +x deploy_ubuntu.sh
sudo ./deploy_ubuntu.sh
```

默认部署目录：

```text
/opt/sharegpt-collab
```

部署后创建账号：

```bash
cd /opt/sharegpt-collab
sudo -u sharegpt node add_user.js <user> <password>
```

## 数据目录

运行时会使用：

- `data/users.json`
- `data/gpt_usage.json`
- `data/chat_history.json`
- `data/client_bootstrap.json`
- `data/proxy_routes.json`
- `data/proxy_routes.json.backup-*`
- `data/proxy_routes.json.corrupt-*`
- `data/releases/`

这些内容都不纳入 Git 版本控制。

## 管理端

配合 `../admin_console/` 使用时，可以直接完成：

- 用户管理
- Sender 默认配置维护
- 安装包上传
- 更新说明发布

上传的安装包会保存到：

```text
data/releases/
```
