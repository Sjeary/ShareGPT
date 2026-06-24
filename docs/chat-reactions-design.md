# 协作消息「表情回应」(Telegram 式) 实现设计

> 需求：给协作消息加「选择表情/标签」的按钮，对标 Telegram 的表情回应系统。先调研实现方式。2026-06-24。

## 1. 调研结论（Telegram 模型）
- 每条消息可被多人用多种表情回应；每种表情显示**计数**，自己点过的高亮。
- 交互：消息悬停/长按 → 弹**快捷表情条**(6 个常用) + 「更多」打开选择器；点击已有的**回应胶囊**=切换(加/取消)自己的该表情。
- 同步：服务端记录每条消息的回应，**实时广播**给同会话所有在线端；计数服务端权威。
- 来源：[Telegram reactions API](https://core.telegram.org/api/reactions)、[Reactions 博客](https://telegram.org/blog/reactions-spoilers-translations)。

## 2. 数据模型
消息对象加一个字段(与现有 `recalled`/`edited` 并列)：
```
reactions: { [emoji: string]: string[] }   // emoji -> 回应过的 username 列表
```
计数 = `reactions[emoji].length`；自己是否回应 = 列表含自己 username。

## 3. 服务端（照 `chat_recall` 同款写法, collab_server2/server.js · ws.on("message")）
新增一个 WS 消息分支 `chat_react`（紧邻 `chat_recall` 2267 行）：
```js
if (payload?.type === "chat_react") {
  const emoji = safeText(payload?.emoji).slice(0, 16);
  const { index, message } = findHistoryMessage(payload?.messageId);
  if (!message || index < 0 || !emoji) return;
  const reactions = message.reactions && typeof message.reactions === "object" ? { ...message.reactions } : {};
  const users = new Set(Array.isArray(reactions[emoji]) ? reactions[emoji] : []);
  if (users.has(ws.username)) users.delete(ws.username); else users.add(ws.username); // 切换
  if (users.size) reactions[emoji] = [...users]; else delete reactions[emoji];
  const updated = { ...message, reactions };
  history[index] = updated;
  persistHistorySnapshot();
  const out = { type: "chat_reaction", messageId: message.id, reactions, roomScope: ws.subnetLabel, timestamp: nowIso() };
  if (message.scope === "private") { /* 同 chat_recall: 发给 from/to 两端 */ }
  else broadcastToSubnet(message.subnetKey, out);
  return;
}
```
- 复用现成 `findHistoryMessage` / `history` / `persistHistorySnapshot` / `broadcastToSubnet`，**纯增量**。
- 部署：照既有 graft 流程 → 3 群（先本地验证）。`buildHistorySyncPayload` 会自然带上 `reactions` 字段(它直接发 message 对象)，无需改。

## 4. 客户端
- **类型**：`ChatMessage` 加 `reactions?: Record<string, string[]>`（useChatStore.ts；hydrate/normalize 容错默认 `{}`）。
- **接收**：useChat.ts 的 WS onmessage 加分支 `type==='chat_reaction'` → `upsertMessage`/专用 action 更新该 id 消息的 `reactions`。
- **发送**：`sendReaction(messageId, emoji)` → `ws.send(JSON.stringify({type:'chat_react', messageId, emoji}))`。
- **UI**（消息气泡组件）：
  - 悬停显示「＋表情」按钮 → 弹快捷条(👍 ❤️ 🔥 😂 🎉 😮 …) + 可选「更多」打开 emoji 选择器(用现成 emoji 或一个轻量 picker)。
  - 气泡下方渲染回应胶囊：`emoji 计数`，自己回应过的高亮(primary 描边)；点击=切换(再发一次 toggle)。
  - 动画：胶囊 出现/计数变化 用 `animate-in zoom-in`，对齐应用整体动效。

## 5. 工作量 / 风险
- 服务端：~30 行 graft + 部署(同套路, 低风险, 增量)。
- 客户端：消息模型 + 收发 + 气泡 UI(主要工作在气泡组件的悬停条 + 胶囊)。
- 难点：快捷条/选择器的定位与触达(对齐现有消息右键/hover 工具)；私聊与房间两种 scope 的广播对象。
- emoji 选择器：先用固定常用集(零依赖)；要全量 emoji 再引 `emoji-mart` 之类。

## 6. 待确认
1. 先做**固定 6-8 个常用表情**(零依赖、最快)，还是直接上**全量 emoji 选择器**(引库)？
2. 一条消息允许多种回应(Telegram 默认非会员最多 1-3 种)；我们**不限种数**可以吗？
3. 服务端这次也照「先本地验证→部署 3 群」走?
