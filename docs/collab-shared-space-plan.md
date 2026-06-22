# 共享协作空间 — 设计方案（计划，未实现）

> 现有协作只有“按 IP 子网自动成房”的聊天 + 私聊。本方案在其上加**显式命名的“空间/频道”**，
> 让一支团队不依赖同一子网也能进同一个协作空间，并在空间内共享资源（提示词、链接、文件、可选的代理配置）。
> 本文是落地前的设计稿，给后续开发用。

## 1. 现状（来自代码探查）

- 客户端：`ChatPanel.tsx` + `useChat.ts`（WebSocket）+ `useChatStore.ts`；登录在 `useAuth.ts`。
- 服务端：`collab_server2/server.js`，WS `/ws?token=`，消息 `scope` 仅两种：
  `subnet`（同子网广播房）/ `private`（1:1）。房间由 IP 自动派生，**用户不能自选/创建房间**。
- 设置：`settings.collab.*`（server_url、pinned_users、通知开关等）。

**痛点**：协作范围被 IP 子网绑死；跨网络/跨地点的团队无法共处一“房”；没有可共享的团队资源区。

## 2. 目标

1. **命名空间（Space/Channel）**：用户可创建/加入显式空间（如“前端组”“某项目”），与子网解耦。
2. **空间内聊天**：在现有 subnet/private 之外新增 `scope: 'space'`，按 `spaceId` 广播。
3. **空间内共享区**：共享提示词、常用链接、文件、公告（团队知识沉淀）。
4. **（可选）共享代理/资源**：与 memory 里 Stage-2“按用户下发代理 YAML”衔接，做空间级资源下发。
5. 权限：空间有 owner/admin/member；可设公开（凭码加入）或受邀。

## 3. 数据模型（服务端，`data/spaces.json` 等）

```
Space { id, name, description, ownerUsername, createdAt,
        joinPolicy: 'invite' | 'code', joinCode?, members: [username...] }
SpaceMember { username, role: 'owner'|'admin'|'member', joinedAt }
SpaceResource { id, spaceId, type: 'prompt'|'link'|'file'|'notice',
                title, body/url/fileRef, createdBy, createdAt }
```

消息持久化复用现有 `chat_history`，新增 `spaceId` 字段；按 space 分桶。

## 4. 服务端改动（`collab_server2/server.js`）

REST：

- `POST /api/spaces` 建空间；`GET /api/spaces` 我的空间列表
- `POST /api/spaces/:id/join`（code/邀请）；`POST /api/spaces/:id/leave`
- `GET /api/spaces/:id/members`；`POST /api/spaces/:id/members`（管理员增删/改角色）
- `GET/POST/DELETE /api/spaces/:id/resources`（共享区 CRUD）

WS：

- 新 `scope: 'space'`，消息体带 `spaceId`；服务端只向该 space 成员投递。
- presence 扩展为“按 space 的在线成员”。
- 入站校验：发 space 消息前确认发送者是该 space 成员（鉴权同现有 Bearer/token）。

## 5. 客户端改动

- **导航**：会话列表（`ConversationList`）在“子网房 / 私聊”之上加“空间”分组；或侧栏新增「协作空间」入口。
- **状态**：`useChatStore` 增 `spaces`、`activeSpaceId`、`messagesBySpace`；`useChat` 处理 `scope:'space'`。
- **空间管理 UI**：创建/加入（输入邀请码）/成员列表/角色管理/退出。
- **共享区 UI**：空间内的「资源」标签页 —— 提示词卡片（一键复制到内嵌 AI 输入框）、链接、文件、公告。
- **设置**：`settings.collab` 增 `last_space_id`、`pinned_spaces` 等。

## 6. 与内嵌 AI 的联动（差异化亮点）

- 共享**提示词库**：空间成员共享 prompt，点一下即填入当前 ChatGPT/Claude 输入框
  （可复用 `ai:execute-javascript` 注入文本）。
- 共享**链接/资源**：点击在内嵌视图或外部浏览器打开（走现有代理）。
- 与翻译插件（见 `translation-plugin-research.md`）正交，可叠加。

## 7. 分期落地

- **P0**：空间的建/加入/成员 + `scope:'space'` 聊天（最小可用）。
- **P1**：共享区（提示词/链接/公告）+ 提示词一键填充内嵌 AI。
- **P2**：文件共享、角色权限细化、空间级资源/代理下发（接 Stage-2 per-user YAML）。

## 8. 风险与注意

- 服务端鉴权：space 成员校验要在每条 WS/REST 入口做，避免越权读他人空间。
- 历史存储：`chat_history` 加 `spaceId` 后注意上限（现 2000 条）与按 space 检索性能。
- 向后兼容：旧客户端不认 `scope:'space'`，服务端需对老版本优雅降级（不投递而非报错）。
