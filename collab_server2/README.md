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
- 管理员托管翻译配置、用户授权和用量统计

## 环境要求

- Node.js 22.12+

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
127.0.0.1:8088
```

生产环境应通过 Caddy/Nginx 提供 HTTPS 和 WebSocket 反向代理。只有明确需要直接监听网络接口时才设置 `HOST=0.0.0.0`，并同时限制云安全组和防火墙来源；部署脚本不会自动开放 `8088`。

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
- `RELEASES_DIR`
- `SESSION_TTL_MS`
- `HISTORY_MAX`
- `GPT_USAGE_MAX`
- `MAX_ATTACHMENTS_PER_MESSAGE`（默认 `4`）
- `MAX_ATTACHMENT_BYTES`（按 data URL 解码后的实际字节校验，默认 30 MiB）
- `MAX_CHAT_PAYLOAD_BYTES`（WebSocket 整条消息上限；默认根据附件数量、实际大小和 Base64 膨胀计算）
- `SHAREGPT_TRANSLATION_MASTER_KEY`（32 字节 hex 或 base64 主密钥）
- `TRANSLATION_PROFILES_FILE`
- `TRANSLATION_USAGE_FILE`

## 托管翻译安全模型

管理员可以创建多个 AI 或通用翻译 API 配置，指定默认配置、授权全部用户或仅授权名单中的用户，并设置用于估算费用的 token/请求单价。客户端只能取得自己可用的配置名称和 ID；上游地址、API Key 及其密文不会下发到客户端。

API Key 使用 `SHAREGPT_TRANSLATION_MASTER_KEY` 通过 AES-256-GCM 加密后落盘。Ubuntu 部署脚本首次安装时会在 `/etc/sharegpt-collab.env` 生成主密钥并将文件权限设为 `0600`，后续部署不会覆盖已有密钥。必须把该环境文件和数据目录作为机密分别备份；丢失或更换主密钥后，已有 API Key 无法解密，需要管理员重新填写。

翻译用量只保存账号、配置、时间、输入/输出字符数、上游返回的 token 数和按管理员单价计算的估算费用，不保存原文或译文。没有返回 token usage 的通用 API 只能统计请求和字符数。估算费用不是上游账单，应以供应商账单为最终依据。

## Sender 默认配置来源

客户端和管理端读取的默认配置来自：

```text
data/client_bootstrap.json
```

如果这个文件尚未完整填写，服务端会优先读取以下环境变量作为建议值：

- `SHAREGPT_SENDER_PROXY_SERVER`
- `SHAREGPT_SENDER_PROXY_PORT`
- `SHAREGPT_SENDER_PROXY_UUID`
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

运行数据独立保存在 `/var/lib/sharegpt-collab`。从旧脚本升级时，现有 `/opt/sharegpt-collab/data` 会只复制缺失文件到新目录，旧目录保留为回滚副本。

部署后创建账号：

```bash
cd /opt/sharegpt-collab
sudo -u sharegpt node add_user.js <user> <password>
```

## 数据目录

运行时会使用 `/var/lib/sharegpt-collab` 下的：

- `users.json`
- `gpt_usage.json`
- `translation_profiles.json`（包含密文，权限应为 `0600`）
- `translation_usage.json`（不包含原文和译文）
- `chat_history.json`
- `client_bootstrap.json`
- `airport.json`、`proxy_routes.json`、`proxy_route_health.json`
- `releases/`、`release_shared/`

这些内容都不纳入 Git 版本控制。

### 聊天历史与发送次数的恢复

`chat_history.json` 与 `gpt_usage.json`、`gemini_usage.json`、`claude_usage.json` 保持原有 JSON 格式。保存工作进入专用后台写入队列，不阻塞 Node 主事件循环；新快照先写入同目录临时文件并同步文件内容，再把旧主文件轮换为同名 `.backup` 并原子替换主文件。存储目录应仅由一个服务进程写入，不支持多个实例共享这些 JSON 文件。

如果主文件损坏且备份有效，服务保留损坏原件为 `.corrupt-<随机标识>`，恢复备份并输出警告。备份可能比最后一次写入旧，恢复不代表最近记录完全无损；统计恢复后的去重也只能依据备份内保存的记录。没有有效备份时会报错并拒绝覆盖，不再把坏文件当作空数据。聊天历史在启动阶段读取，无法恢复时需要管理员修复文件后再启动；使用统计读写失败会向请求方返回错误。

遇到恢复警告时，应暂停服务并备份整个数据目录（包括 `.backup` 和 `.corrupt-*`），核对聊天记录和发送次数后再恢复运行。不要把损坏原件或这些含用户数据的备份提交到 Git。自动快照不能替代独立、定期且经过恢复演练的服务器备份，也不保证磁盘损坏或突然断电时零丢失。

## 管理端

配合 `../admin_console/` 使用时，可以直接完成：

- 用户管理
- Sender 默认配置维护
- 安装包上传
- 更新说明发布
- 托管翻译配置、用户授权和用量统计

上传的安装包会保存到：

```text
/var/lib/sharegpt-collab/releases/
```
