# 日历 / 待办 — 进阶集成设计（与现有功能打通）

> 三大新功能（个人日历 / 组队日历 / 备忘录·待办）不只是独立模块，更要和 ShareGPT 已有的
> 协作聊天、内嵌 AI、统一代理、统计、通知、新手引导等串起来。本文枚举集成点，标注**已实现 / 规划中**，
> 并给出落地方式。集成层统一收口在 `src/renderer-next/src/lib/integrations.ts`（通过各 store 的
> `getState()` 运行时调用，避免组件间耦合 import）。

## 一、本轮已实现 ✅

| #   | 集成                            | 入口                     | 实现                                                                                                                                  |
| --- | ------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **待办 → 个人日历（单条）**     | 任务编辑器「加入日历」   | `syncTaskToCalendar(taskId)`：按到期日/时间生成事件，落入专用「待办」日历(#a855f7)，回写 `task.calendarEventId`，再次同步更新而非重复 |
| 2   | **待办 → 个人日历（一键全部）** | 待办列表头「同步到日历」 | `syncAllTasksToCalendar()`：同步所有「未完成且有到期日」的任务                                                                        |
| 3   | **个人日历事件 → 组队日历**     | 事件编辑器「共享到团队」 | `shareEventToTeam()`：写入团队 store + 本地降级存储；已登录则尽力 POST 到协作服务器同步给全员                                         |
| 4   | **导入外部日历 (.ics)**         | 日历工具栏「导入」       | `lib/ics.ts` 解析 VEVENT（折行/全天/时区/转义），导入到专用「导入」日历                                                               |
| 5   | **侧栏今日角标**                | 左侧导航                 | 个人日历=今日事件数、待办=今日(含逾期)未完成数；收起态显示红点                                                                        |
| 6   | **新手引导覆盖新功能**          | 标题栏「?」              | 导览新增 个人日历/组队日历/待办 三步高亮                                                                                              |
| 7   | **组队日历复用协作身份**        | —                        | 复用 `useChatStore.identity`(serverUrl/token/username)，按房间(subnetKey)隔离；服务端 `collab_server2` REST + WS                      |
| 8   | **字体可读性**                  | 三功能全量               | 正文升到 14–16px，标题更大，行高/间距同步放大                                                                                         |
| 9   | **个人日历/待办 云端同步**      | 面板顶「云」状态条       | 多端实时 + 版本号防覆盖，详见下节                                                                                                     |

### 1.1 个人日历 / 待办 云端同步（本轮新增）

- **多端同步**：登录后，个人日历(`calendar.json`)与待办备忘(`tasks.json`)按**用户**同步到协作服务器；换设备登录同账号即可拉到。
- **实时**：一端写入 → 服务器经 WebSocket 把更新推给同一用户的其它在线端，其它端即时合并刷新。
- **防止老版本覆盖新版本**：服务器对每个 (用户, 种类) 维护单调 `rev`；客户端写入须带 `baseRev`，不等于服务器当前 `rev` 即返回 **409**，客户端先合并服务器最新再带新 `rev` 重试——老版本永远无法覆盖新版本（已单测：`putUserStore`）。
- **合并**：按条目 `id` 合并；事件/任务/便签取 `updatedAt` 较新者；日历/清单（配置类）并集本地优先。
- **降级**：未登录或服务器不支持该接口 → 静默纯本地（面板显示「仅本地」），功能不受影响。
- **落点**：服务端 `collab_server2/server.js` 的 `GET/PUT /api/user-store/:kind` + WS `user_store_updated`；客户端 `lib/cloudSync.ts` + `hooks/useCloudSync.ts`（在 Shell 挂载）。
- **部署提醒**：真正多端联通需把本轮服务端改动部署到协作服务器；远端服务器没有这些接口时客户端自动「仅本地」。

## 二、规划中（已预留接口，建议下一步做）🔜

### 与协作聊天

9. **分享事件/任务到聊天**：`integrations.ts` 已留 `registerChatSender()/sendToChat()`。让聊天面板挂载时注册其房间发送函数，则日历事件/待办可「发送到协作聊天」（一条带时间/标题/地点的卡片消息）。
10. **聊天消息 → 待办/事件**：聊天气泡右键「转为待办」「加入日历」（复用本应用已有的 AI 网页右键菜单范式）。
11. **@提醒落地**：聊天里 @我 且含时间的消息，提示「加入日历」。

### 与内嵌 AI（ChatGPT / Claude）

12. **AI 规划今日**：把今天的日程 + 待办拼成 prompt，经 `api.executeAiJavaScript` 注入 ChatGPT 输入框，「让 AI 帮我安排今天」。
13. **AI 拆解任务**：选中一个大任务 → AI 生成子任务清单 → 回填 `addSubtask`。
14. **AI 总结/复盘**：把「已完成」任务 + 本周事件喂给 AI 出周报（再可一键发协作聊天）。

### 与统计 / 通知 / 代理

15. **统计页加生产力卡片**：今日完成数、按清单/优先级分布、事件密度热力（复用 StatsPanel 卡片范式）。
16. **系统通知做提醒**：事件 alert / 任务到期，用现有 `api.showSystemNotification` 推送（点通知跳到对应项，复用 `onAppEvent` 通知路由）。
17. **外部日历订阅(webcal/https)走代理**：.ics 订阅 URL 通过主进程 + sing-box SOCKS 拉取并定时刷新（复用 `socks-proxy-agent`），避免墙内直连失败。

### 跨三者

18. **统一「今天」聚合视图**：把今日事件 + 今日待办合并成一个 Today 仪表盘（待办已能投影到日历，可反向在日历日视图显示待办行）。
19. **资料包导出/备份纳入**：把 `calendar.json` / `tasks.json` 一并加入「导出资料包」与更新前备份（`UPDATE_BACKUP_ENTRIES`）。
20. **组队日历 ↔ 在线状态/目录**：参与人候选取自聊天在线目录；空闲/忙碌叠加（已有成员侧栏雏形）。

## 三、数据/接口落点速查

- 个人日历 store：`useCalendarStore`（`addEvent/updateEvent/importEvents/addCalendar`）。
- 待办 store：`useTasksStore`（`addTask/updateTask/addSubtask`；新增 `task.calendarEventId` 关联）。
- 组队日历：`useTeamCalendarStore` + `useTeamCalendar` hook（server/local 双模）；服务端 `collab_server2/server.js` 的 `/api/team-calendar/*`。
- 集成层：`src/renderer-next/src/lib/integrations.ts`（本轮新增；规划项继续往这里加）。
- 复用能力：`api.executeAiJavaScript`(注入 AI 输入框)、`api.showSystemNotification`(通知)、`api.onAppEvent`(通知点击路由)、`socks-proxy-agent`(代理拉取)、资料包导出/备份。

> 备注：本分支为测试分支（`feat/calendar-team-todo`），仅本地，未推送 GitHub。
