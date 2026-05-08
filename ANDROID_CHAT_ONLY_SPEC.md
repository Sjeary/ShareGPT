# ShareGPT Android Chat-Only 开发文档

## 目标

本阶段只开发安卓端的两个核心能力：

- 用户登录
- 聊天功能

不包含以下内容：

- Sender / Receiver 代理能力
- sing-box / frpc 本地运行
- 内嵌 ChatGPT / Gemini 网页
- 管理端功能
- AI 使用统计

目标是做一个界面风格尽量接近桌面端 ShareGPT 的安卓聊天客户端。

---

## 推荐技术路线

推荐使用 **Flutter** 开发安卓端。

原因：

- UI 还原能力强，方便贴近当前桌面版视觉风格
- 消息列表、会话列表、图片预览、主题切换都适合 Flutter
- 后续如果要扩到 iOS，可以复用大部分代码
- 对本地缓存、WebSocket、图片选择、升级保留数据都有成熟方案

建议技术选型：

- UI：Flutter
- 状态管理：Riverpod 或 Bloc
- HTTP：`dio`
- WebSocket：Flutter 原生 `WebSocketChannel` 或 `dart:io` WebSocket
- 本地数据库：`drift` 或 `isar`
- 安全存储：`flutter_secure_storage`
- 图片选择：`image_picker`
- 文件选择：`file_picker`
- 系统通知：`flutter_local_notifications`
- 应用升级：后续按 Android 正常覆盖安装处理

---

## 最重要的产品要求

安卓端第一版必须满足：

1. 登录成功后进入聊天主界面
2. 能看到联系人列表和最近会话
3. 支持房间消息和私聊
4. 支持历史消息加载
5. 支持未读计数
6. 支持图片消息显示
7. 服务端重启后自动恢复连接
8. **应用更新后，本地登录状态和聊天缓存不能丢**

---

## 与现有服务端的关系

安卓端直接复用当前服务端：

- [server.js](/C:/Users/sjr12/Desktop/singbox封装项目/v4_electron/collab_server2/server.js)

安卓端不需要改服务端协议即可开始开发聊天功能。

当前服务端已经具备：

- 登录接口
- 用户列表接口
- 个人资料接口
- WebSocket 实时消息
- 历史同步
- 私聊已读回执
- 房间已读回执
- 消息撤回
- 消息编辑
- 输入中状态同步
- 服务端重启后的重新登录恢复支持

---

## 服务地址格式

客户端登录时要求：

- 服务地址必须以 `http://` 或 `https://` 开头

示例：

```text
http://server.example.com:8088
```

WebSocket 地址从 HTTP 地址自动转换：

- `http://...` -> `ws://...`
- `https://...` -> `wss://...`

---

## 登录接口

### 请求

`POST /api/login`

请求体：

```json
{
  "username": "demo_user",
  "password": "demo_password",
  "client": {
    "name": "sharegpt-android",
    "version": "0.1.0",
    "platform": "android",
    "arch": "arm64-v8a",
    "mode": "chat"
  }
}
```

说明：

- `client` 对象建议安卓端保留，用于服务端记录客户端版本
- 字段名可以尽量对齐桌面端的客户端信息上报逻辑

### 成功返回

HTTP `200`

```json
{
  "token": "...",
  "username": "demo_user",
  "profile": {
    "username": "demo_user",
    "displayName": "Demo User",
    "avatar": "😀",
    "avatarKind": "emoji",
    "bio": "...",
    "online": true,
    "disabled": false,
    "updatedAt": "2026-04-20T10:00:00.000Z",
    "client": {
      "name": "sharegpt-desktop",
      "version": "4.1.0",
      "platform": "win32",
      "arch": "x64",
      "mode": "sender",
      "reportedAt": "2026-04-20T10:00:00.000Z"
    }
  },
  "roomScope": "192.168.1",
  "users": [],
  "history": []
}
```

### 失败返回

- `400`：用户名或密码为空
- `401`：账号或密码错误
- `500`：登录失败

---

## 其他 HTTP 接口

### 用户列表

`GET /api/users`

Header:

```text
Authorization: Bearer <token>
```

返回：

```json
{
  "users": [],
  "roomScope": "192.168.1",
  "timestamp": "2026-04-20T10:00:00.000Z"
}
```

### 个人资料

`GET /api/profile`

Header:

```text
Authorization: Bearer <token>
```

返回：

```json
{
  "profile": {},
  "roomScope": "192.168.1"
}
```

### 登出

`POST /api/logout`

Header:

```text
Authorization: Bearer <token>
```

返回：

```json
{
  "ok": true
}
```

---

## WebSocket 连接

连接方式：

```text
ws://server.example.com:8088?token=<token>
```

或：

```text
wss://server.example.com:8088?token=<token>
```

其中 `token` 来自 `/api/login`。

### 连接建立后，服务端主动推送

#### 1. `session`

```json
{
  "type": "session",
  "username": "demo_user",
  "displayName": "Demo User",
  "avatar": "😀",
  "avatarKind": "emoji",
  "client": {},
  "roomScope": "192.168.1",
  "timestamp": "2026-04-20T10:00:00.000Z"
}
```

用途：

- 更新当前登录身份
- 更新当前房间标识 `roomScope`

#### 2. `history`

```json
{
  "type": "history",
  "messages": [],
  "roomScope": "192.168.1",
  "timestamp": "2026-04-20T10:00:00.000Z"
}
```

用途：

- 首次连接后的完整可见历史

#### 3. `presence`

桌面端收到后会刷新用户列表。安卓端也应同样处理。

返回中通常会带：

- `users`
- `roomScope`
- `timestamp`

---

## 客户端主动发送的 WebSocket 消息

### 1. 拉增量历史

```json
{
  "type": "history_sync",
  "since": "2026-04-20T10:00:00.000Z"
}
```

服务端返回：

```json
{
  "type": "history_sync",
  "messages": [],
  "roomScope": "192.168.1",
  "timestamp": "2026-04-20T10:00:00.000Z"
}
```

说明：

- 安卓端应保存本地历史游标 `since`
- 连接成功后立即发一次 `history_sync`
- 这样在服务端重启或自己离线后，可以补齐消息

### 2. 发送聊天消息

#### 房间消息

```json
{
  "type": "chat",
  "scope": "subnet",
  "text": "大家好",
  "attachments": [],
  "replyTo": null,
  "forwardedFrom": null
}
```

#### 私聊消息

```json
{
  "type": "chat",
  "scope": "private",
  "to": "target_user",
  "text": "你好",
  "attachments": [],
  "replyTo": null,
  "forwardedFrom": null
}
```

### 3. 输入中状态

#### 私聊

```json
{
  "type": "chat_typing",
  "scope": "private",
  "to": "target_user",
  "active": true
}
```

#### 房间

```json
{
  "type": "chat_typing",
  "scope": "subnet",
  "active": true
}
```

### 4. 已读回执

#### 私聊已读

```json
{
  "type": "chat_read",
  "scope": "private",
  "with": "target_user",
  "messageIds": ["msg1", "msg2"]
}
```

#### 房间已读

```json
{
  "type": "chat_read",
  "scope": "subnet",
  "messageIds": ["msg1", "msg2"]
}
```

### 5. 撤回消息

```json
{
  "type": "chat_recall",
  "messageId": "msg1"
}
```

### 6. 编辑消息

```json
{
  "type": "chat_edit",
  "messageId": "msg1",
  "text": "编辑后的内容"
}
```

---

## 服务端推送的 WebSocket 消息类型

### `chat`

普通聊天消息。房间和私聊都用这个结构。

### `chat_typing`

输入中状态。

### `chat_read`

已读回执，安卓端要合并到本地消息记录里。

### `chat_recall`

撤回事件，`message.recalled = true`。

### `chat_edit`

编辑事件，`message.edited = true`。

### `system`

系统消息，例如用户上线、离线。

### `error`

服务端错误提示，例如：

- 目标用户不存在
- 只能撤回自己的消息
- 只能编辑自己的消息

---

## 标准消息结构

根据当前服务端和桌面端实际逻辑，安卓端消息模型建议按下面定义：

```json
{
  "id": "message_id",
  "type": "chat",
  "scope": "private",
  "from": "sender_username",
  "to": "target_username",
  "username": "sender_username",
  "displayName": "Sender Name",
  "avatar": "😀",
  "text": "hello",
  "attachments": [],
  "replyTo": {
    "id": "origin_id",
    "from": "origin_user",
    "displayName": "Origin User",
    "preview": "原消息预览",
    "timestamp": "2026-04-20T10:00:00.000Z"
  },
  "forwardedFrom": {
    "from": "origin_user",
    "displayName": "Origin User"
  },
  "subnetKey": "192.168.1",
  "subnetLabel": "192.168.1",
  "timestamp": "2026-04-20T10:00:00.000Z",
  "readAt": "2026-04-20T10:00:10.000Z",
  "readBy": [
    {
      "username": "reader1",
      "displayName": "Reader 1",
      "readAt": "2026-04-20T10:00:12.000Z"
    }
  ],
  "edited": false,
  "editedAt": "",
  "recalled": false,
  "recalledAt": ""
}
```

说明：

- 私聊主要看 `readAt`
- 房间消息主要看 `readBy`
- `scope = private` 表示私聊
- `scope = subnet` 表示房间消息

---

## 附件结构

当前桌面端和服务端用的是 Data URL 形式。

```json
{
  "kind": "image",
  "name": "image.png",
  "mime": "image/png",
  "size": 123456,
  "dataUrl": "data:image/png;base64,..."
}
```

约束：

- 每条消息最多 `4` 个附件
- 单个附件最大 `30MB`
- 当前安卓第一版建议优先支持：
  - 图片消息
  - 普通文件消息展示

注意：

- 现在服务端不是单独文件上传接口，而是直接把附件内容放进消息里
- 安卓端第一版可以先沿用这个协议，不额外改服务端
- 后续如果要优化流量和性能，再改成独立文件上传

---

## 会话划分规则

安卓端本地会话 key 建议直接照桌面端：

### 私聊

```text
user:<username>
```

### 房间

```text
room:<roomScope>
```

例如：

- `user:alice`
- `room:192.168.1`

这样可以直接兼容当前桌面端的数据组织思路。

---

## 未读逻辑

安卓端建议和桌面端保持一致：

### 私聊未读
当满足以下条件时记为未读：

- `scope == private`
- `from == 对方`
- `to == 当前用户`
- `readAt` 为空
- `recalled == false`

### 房间未读
当满足以下条件时记为未读：

- `scope == subnet`
- `from != 当前用户`
- `recalled == false`
- `readBy` 中不存在当前用户

### UI 建议
- 最近会话显示未读气泡
- 进入会话页并看到消息后，立即发送 `chat_read`

---

## 自动重连与服务端重启恢复

安卓端必须实现两段式恢复：

### 第一段：Socket 重连
- WebSocket 断开后按退避策略重连
- 建议：1.5s、3s、4.5s、6s ... 上限 12s

### 第二段：静默重新登录
如果出现以下情况：

- WebSocket 连不上
- token 失效
- 服务端重启导致原 session 丢失

则自动重新调用：

```text
POST /api/login
```

使用：

- 上次成功登录的 `serverUrl`
- `username`
- 本机安全存储中的密码

成功后：

- 更新 token
- 重新建立 WebSocket
- 自动发送 `history_sync`
- 保留本地会话列表、草稿、未读数和聊天缓存

如果密码不可用：

- 停止静默恢复
- 跳到登录页
- 提示“服务已重启，请重新登录”

---

## 安卓端本地存储设计

建议把数据分为两层：

### 1. 安全存储层
用于保存：

- `serverUrl`
- `username`
- `token`
- `password` 或 refresh 用密码缓存

推荐：

- `flutter_secure_storage`

### 2. 本地数据库层
用于保存：

- 用户资料缓存
- 最近会话摘要
- 消息列表
- 未读计数
- 当前房间 `roomScope`
- 草稿内容
- 最后历史游标 `since`

推荐：

- `drift`

---

## 更新后数据不能丢：安卓端必须这样做

这是必须落实的要求。

### 原则
安卓端所有用户数据都必须保存在：

- App 的持久化沙盒目录
- 安全存储
- 本地数据库

而不是：

- 临时目录
- 内存单例
- 安装包资源目录

### 必须持久化的内容
- 服务地址
- 用户名
- 登录 token
- 密码缓存或可恢复凭据
- 最近会话列表
- 已拉取的聊天历史
- 未读状态
- 草稿
- 主题设置

### 更新时为什么不会丢
正常 Android 覆盖安装时：

- App 私有目录会保留
- SQLite / Drift 数据库会保留
- `flutter_secure_storage` 内容会保留
- SharedPreferences / 本地配置会保留

所以只要不主动清理本地数据，升级到新版本后用户状态会继续存在。

### 安卓端开发约束
必须避免：

- 每次启动都重置本地数据库
- 升级后自动清空缓存
- token 过期时直接把所有本地消息删掉

正确做法：

- 登录态失效只清理认证状态，不清理消息缓存
- 重新登录成功后重新同步历史
- 本地会话和消息先展示，再后台增量补齐

---

## 第一版 UI 建议

安卓端只做聊天时，建议页面结构：

### 1. 登录页
- 服务地址
- 用户名
- 密码
- 记住登录

### 2. 主聊天页
底部两栏即可：

- 最近会话
- 联系人

### 3. 会话详情页
- 顶部：用户名 / 房间名
- 中间：消息列表
- 底部：输入框 + 图片按钮 + 发送按钮

### 4. 设置页
- 退出登录
- 提醒设置
- 主题设置
- 当前服务地址

第一版不要引入太多复杂页面，优先把消息链路跑通。

---

## 推荐的数据模型

建议安卓端至少定义这些模型：

- `AuthSession`
- `UserProfile`
- `ConversationSummary`
- `ChatMessage`
- `ChatAttachment`
- `ReplyTarget`
- `ForwardedFrom`
- `ReadByEntry`
- `SocketEvent`

---

## 开发顺序建议

### 第一阶段
- 完成登录页
- 接通 `/api/login`
- 保存登录态
- 建立 WebSocket

### 第二阶段
- 做最近会话列表
- 做联系人列表
- 接收 `chat` / `history` / `history_sync`

### 第三阶段
- 完成消息发送
- 完成私聊和房间切换
- 完成已读逻辑

### 第四阶段
- 完成自动重连
- 完成服务端重启后的静默恢复
- 完成本地数据库持久化

### 第五阶段
- 完成图片消息
- 完成系统通知
- 完成 UI 精修

---

## 安卓端开发的下一步

建议下一步直接开始这两件事：

1. 新建 Flutter 工程 `sharegpt_android`
2. 先把以下模块搭出来：
   - `auth`
   - `chat`
   - `contacts`
   - `storage`
   - `network`
   - `ws`

如果后续继续推进，建议再补两份文档：

- `ANDROID_UI_TOKENS.md`：移动端配色、圆角、间距、字体规范
- `ANDROID_DATA_MODEL.md`：Flutter 端的数据表结构和实体定义
