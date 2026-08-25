# AI 高级环境审查整改报告

## 范围与结论

审查对象为 `main...codex/fix-ai-review-compliance` 中与多账号 AI 环境、内置 sing-box 线路、翻译侧栏、协作服务端和管理后台有关的改动。

当前结论：本轮可由代码和隔离测试验证的审查项已经整改完成，自动化门禁通过。真实 ChatGPT/Claude 账号、管理员线上下发和真实出口链路仍需在不改变既有线路绑定的前提下做人工验收；在用户明确允许前，不合并到 `main`。

## 不得破坏的产品约束

- 普通基础功能保持原有行为，不因高级 AI 授权缺失而不可用。
- 高级环境只允许管理员或管理员明确授权的用户使用。
- 高级线路目录缺失、拉取失败或撤权时必须 fail-closed。
- 不允许高级环境在绑定线路失效时静默切换到其他出口。
- Claude 与 ChatGPT 的既有线路分配不得被测试或迁移代码擅自修改。
- 不启动额外 mihomo/Clash 实例，不依赖用户外填本机 IP 和端口。
- 不把代理凭据、订阅地址、API Key、密码或 token 写入日志、导出包、公开文档或 Git。
- 未经明确允许，不合并到 `main`，不发布新版本。

## 已完成整改

- 可用线路过滤已拒绝非法、禁用、未授权和重复线路，并在授权缺失时 fail-closed。
- 登录、退出、静默重登失败和线路变更会清理旧账号线路，停止 sender，并关闭高级 workspace。
- translation 已进入统一设置 schema，并支持旧 `notesAi` 配置迁移。
- settings 已增加 revision、原子写入、备份恢复、冲突重试和敏感字段加密；普通导出会脱敏。
- Notes AI 已统一终止状态，防止重复 `done/error`，取消时会清理请求和重试定时器。
- 健康检查已使用三态语义，真实出口身份与配置检查分开，不再把未检测项展示为通过。
- 环境删除、环境切换 generation、健康结果失效、workspace 预检顺序已修复。
- sender 启动会探测端口占用并等待所有监听端口就绪。
- 已移除通用网页 JavaScript 执行 IPC，profile 使用独立最小 preload，Vault 根目录通过主进程目录选择器设置。
- WebSocket 已限制 payload，客户端不再把 token 放入 URL，附件按真实 Base64 字节数校验。
- 管理员原始/有效高级权限已拆分，并增加会话撤销和最后管理员保护。
- CI 使用 `npm ci` 并运行 renderer 单元测试。
- 主窗口和个人资料窗口已启用 Electron sandbox；个人资料窗口只允许调用自身上下文和窗口控制 IPC。
- Notes AI 与翻译 API 共用端点安全策略：远程仅 HTTPS、离线仅精确回环地址、DNS 全结果校验、连接地址固定且保留 TLS SNI。
- API/离线翻译已增加真实请求取消；切换标签、关闭侧栏和发起新翻译会中止旧 HTTP(S) 请求。
- 翻译内容、状态和异步结果按 `kind + tabId + generation` 隔离；代理检测结果按服务、环境和标签绑定。
- 管理后台登录、退出、鉴权失效和服务器切换会清空服务器作用域状态，并拒绝旧会话响应回写。
- 服务端托管线路保存改为全量严格校验、候选备份成功后再原子替换、损坏隔离与最近有效备份恢复。
- renderer 完整依赖 `npm audit` 为 0；根项目打包工具链和管理端构建工具链仍有 2026-08-26 新增的上游安全公告，见“当前自动化基线”。
- AI 标签激活时的 `ensure` 失败已进入统一错误反馈，不再形成 renderer 未处理 Promise rejection。

## 原始审查逐项结果

| #   | 审查项                          | 当前状态     | 验证依据                                                                    |
| --- | ------------------------------- | ------------ | --------------------------------------------------------------------------- |
| 1   | 可用线路过滤错误                | 已完成       | 非法、禁用、未授权、重复及缺失授权均有 renderer 单测                        |
| 2   | 翻译设置无法持久化              | 已完成       | 统一 `translation` schema、旧 `notesAi` 迁移、save/reload 与跨 section 测试 |
| 3   | 账号切换残留旧线路              | 已完成       | Electron A/B 临时账号实测；普通账号不继承高级入口、托管线路或旧授权         |
| 4   | Notes AI 终止/重试/取消错误     | 已完成       | 单终止事件、非 2xx、尾行 SSE、timeout、backoff cancel 单测                  |
| 5   | 明文远程接口与敏感配置          | 已完成       | 默认远程地址为空、远程 HTTPS、私网/metadata 拒绝、导出脱敏与本地加密已覆盖  |
| 6   | settings 丢失更新与损坏恢复     | 已完成       | revision、section patch、原子写、备份恢复及冲突测试                         |
| 7   | 虚假的 DNS/IPv6/WebRTC 通过     | 展示语义完成 | 未实测项目显示“未检测”，配置检查与出口身份拆分；真实泄漏探测仍是实机验收项  |
| 8   | 翻译/代理检测跨标签污染         | 已完成       | 翻译 generation 测试、真实请求取消、代理报告 target key 绑定                |
| 9   | 删除环境产生幽灵记录            | 已完成       | 主进程删除事务与延迟 partition 清理队列                                     |
| 10  | 线路切换保留旧健康结果/名称失控 | 已完成       | 健康结果失效、受控名称 draft、保存失败回滚与名称测试                        |
| 11  | 健康预检前创建 workspace        | 已完成       | 先解析线路并预检，再创建/加载 workspace                                     |
| 12  | Accessibility debugger 长期保持 | 已完成       | `disable` 与 attach 所有权清理                                              |
| 13  | 端口冲突与 sender 假就绪        | 已完成       | bind 探测、全端口 ready 等待及进程提前退出测试                              |
| 14  | 服务端静默丢弃/回退线路         | 已完成       | 精确字段错误、整批拒绝、损坏隔离、备份恢复与故障注入测试                    |
| 15  | 窄窗口翻译侧栏挤压网页          | 隔离测试完成 | `860x620`、`1024x640`、`1440x900` 自动截图且外层无横向溢出                  |
| 16  | 工具栏拥挤                      | 隔离测试完成 | 动态内容截断、隐藏/恢复与响应式窗口矩阵已通过                               |
| 17  | 标签语义和键盘支持不足          | 已完成       | `tablist/tab/aria-selected` 与方向键、Home/End                              |
| 18  | 全局 Escape 干扰编辑            | 已完成       | 仅存在隐藏区且非可编辑目标时处理                                            |

## 本轮 P0 整改

### P0：远程接口与 SSRF 防护（完成）

- AI/翻译远程接口必须默认空配置。
- 非回环地址只允许 HTTPS。
- 离线模式只允许 `localhost`、`127.0.0.1` 和 `::1`。
- 解析域名后拒绝回环、私网、链路本地、多播、未指定地址和云 metadata 地址。
- 请求建立前重新校验实际解析地址，禁止通过重定向绕过。
- Notes AI 与翻译 API 共用同一套端点安全策略。
- 增加 HTTPS、回环 HTTP、私网、metadata、非法协议和 DNS 解析结果测试。

### P0：跨标签翻译状态与取消（完成）

- 翻译状态按 `kind:tabId` 隔离，或者切换标签时明确清空旧内容。
- 所有异步结果必须携带 generation/requestId，旧结果不得写入新标签。
- AI、API 和离线翻译都必须支持实际取消；关闭侧栏和切换标签时中止后端请求。
- 未准备好网络或不存在活动标签时禁用翻译动作。
- 增加跨标签、关闭面板、延迟返回和取消重试测试。

### P0：真实线路功能验证（待受控实机验收）

- 验证普通模式不依赖高级线路授权。
- 验证多个 ChatGPT 环境保持管理员指定线路，Claude 保持其独立线路。
- 验证线路撤权、禁用和 catalog 更新后，活动 workspace 关闭且 sender 按权威配置重建。
- 验证实际出口 IP 与 expected IP 一致，DNS 配置与对应 outbound 一致。
- 未实现真实 DNS/IPv6/WebRTC 泄漏探测前，只能显示“配置检查/未检测”，不能显示“防泄漏通过”。

## 高优先级整改

- 托管线路按 outbound 类型校验必填字段，返回精确字段路径；损坏 catalog 应隔离并恢复最近有效版本。
- 管理后台在登录、退出、鉴权失效和服务器地址变化时清空全部服务器作用域状态。
- 环境名称改为受控 draft，保存失败回滚，外部更新能同步。
- 为 Notes AI 补齐 timeout、retry-backoff cancel、HTTP 非 2xx 和无换行 SSE 尾行测试。
- 为 translation 设置增加 save/reload 往返与并发 section patch 测试。
- 为账号 A 退出、账号 B bootstrap 失败补集成测试。

## 2026-08-26 本机 Electron 验证

- 新增 `npm run verify:ai-review-ui`，使用临时用户目录、临时协作服务器、两条管理员下发的回环线路和本地翻译服务；真实账号 Cookie、用户线路和外部 AI 网站均不参与。
- 登录按钮在首屏可见，无需滚动。
- 三个 ChatGPT 环境可新增、改名、换线和删除，设置持久化结果与 UI 一致。
- 标签具备 `tablist/tab/aria-selected` 语义，方向键和 Home 键切换正常。
- 本地离线翻译显示在 ShareGPT 独立侧栏；切换标签会中止请求，延迟结果不会污染新标签。
- Cmd `+`、`-`、`0` 会同步外壳与内嵌 WebContents zoom；窗口矩阵没有外层横向溢出。
- 侧栏和顶部信息栏可独立隐藏，Escape 恢复正常。
- Claude 网址输入默认不出现，只在点击“打开网页”后展开，并在独立内部标签打开。
- 高级账号退出后登录普通账号，普通账号看不到高级环境和翻译入口，托管线路及授权数组为空。
- 自动化发现并修复标签激活 `ensureAiWorkspace` 拒绝未捕获问题；修复后 renderer `pageerror` 为 0。

## 长期安全与可靠性

- 评估主窗口启用 Electron sandbox，并按窗口类型校验敏感 IPC sender。
- 逐项验证全局禁用 Chromium 存储/网络隔离 flag 的必要性，形成兼容模式与隐私模式。
- 服务端配置明确 CORS origin；未捕获异常后 graceful shutdown。
- 首管理员初始化增加一次性 setup token 或互斥保护。
- 高频 JSON 数据逐步迁移到 SQLite 或具备事务与并发控制的存储。

## UI 与可访问性验收

- 翻译侧栏：宽屏为可控侧栏，窄屏为覆盖式 drawer，不挤压网页到不可用宽度。
- 工具栏：动态名称截断并提供 tooltip；中小宽度时次要动作折叠，不能横向遮挡。
- AI 标签：标准 tab 语义、方向键/Home/End 导航、焦点可见。
- Escape 只在确有隐藏区域、焦点不在可编辑控件且没有更高优先级弹层时恢复布局。
- 环境和线路操作具有 saving/error 状态，危险删除需要确认。

## 测试门禁

- `npm test`
- `npm --prefix src/renderer-next test`
- `npm --prefix src/renderer-next run build`
- `npm --prefix admin_console/ui run build`
- `npm run typecheck:main`
- `npm run lint`
- `npm run format:check`
- Electron 功能矩阵：`860x620`、`1024x640`、`1280x720`、`1440x900`，以及 `80%`、`100%`、`125%`、`150%` 缩放。
- 实机线路矩阵：普通统一代理、ChatGPT 多环境、Claude 独立环境、在线撤权、sender 重启、退出/重登。

## 当前自动化基线

- 主进程与服务端单元测试：76/76 通过。
- renderer 单元测试：11/11 通过。
- renderer production build：通过。
- admin console production build：通过。
- 主进程 checkJs 类型检查：通过。
- 根目录 ESLint：0 error（保留 49 个历史 warning）。
- Electron 隔离 GUI：两套通过；隐私/密码复核/分区重建，以及高级环境/翻译/标签/缩放/布局/A-B 权限隔离均正常。
- npm audit（2026-08-26）：renderer 0；根项目 10 项（9 high、1 critical，主要来自 `electron-builder@24` 打包工具链，完整修复要求破坏性升级到 26）；admin console 2 high（`nanoid/postcss` 构建链）。本轮未擅自执行 `--force` 升级。
- 本次变更文件 Prettier 与 `git diff --check`：通过。全目录检查只命中未跟踪、未纳入本分支的 `website/` 草稿，未擅自修改。

## 尚需人工验收

- 使用当前管理员下发配置验证三个 ChatGPT 环境仍绑定 `internal-unified`，Claude 环境仍绑定管理员指定的独立线路；测试不得改写这两组绑定。
- 在真实出口环境验证 expected IP、DNS detour、IPv6 和 WebRTC；未实现的真实探测继续显示“未检测”。
- 使用真实 GPT/Claude 页面补做 `1280x720` 和完整 `80%`、`125%`、`150%` 视觉截图；隔离页面已完成 `860x620`、`1024x640`、`1440x900` 与 Cmd 缩放同步验证。
- renderer 独立 ESLint 目前仍有 26 个该分支既存错误；当前 GitHub Actions 不运行该命令，不能把它误报为本轮通过，建议单独建清理任务后再加入 CI。
