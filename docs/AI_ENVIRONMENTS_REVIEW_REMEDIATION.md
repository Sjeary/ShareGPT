# AI 高级环境审查整改报告

## 范围与结论

本报告核对了 2026-08-26 共 718 行 review 原文，并以 `3af3ee9` 为安全整改起点。review 指出的分支分叉属实：`codex/fix-ai-review-compliance` 未包含 `codex/feat-ai-environments` 的 `ee35030`。本修复分支已最小化 cherry-pick 该提交，未 rebase 或强推任何共享分支。

本轮确认的 P0/P1 已完成代码整改与隔离自动化。测试没有访问真实 GPT/Claude 账号，没有修改真实线路绑定，也没有启动或修改 mihomo/Clash。真实管理员下发、真实出口身份以及 DNS/IPv6/WebRTC 仍属于受控人工验收范围。未经用户另行允许，不合并或推送 `main`，不发布版本。

## Review 逐项判断

### 原始 18 项

| #   | 审查项                          | 判断     | 处理与依据                                                                                                                                                                                                                                         |
| --- | ------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 可用线路过滤错误                | 正确     | 非法、禁用、未授权、重复线路及授权缺失均 fail-closed；普通 unified 不依赖高级授权。                                                                                                                                                                |
| 2   | 翻译设置无法持久化              | 正确     | 已纳入统一 settings schema，并覆盖旧配置迁移和 save/reload。                                                                                                                                                                                       |
| 3   | 账号切换残留旧线路              | 正确     | 登录 principal 切换会关闭 workspace、停止 sender、取消翻译并清空旧运行态。                                                                                                                                                                         |
| 4   | Notes AI 终止/重试/取消错误     | 正确     | 统一单终止状态；同步抛错、timeout、cancel、retry 和错误正文上限均有测试。                                                                                                                                                                          |
| 5   | 明文远程接口与敏感配置          | 部分正确 | 默认地址为空、私网与特殊地址拒绝、导出脱敏正确；产品决策 [PD-001](PRODUCT_DECISIONS.md#pd-001远程-translation-与-notes-ai-接口允许公网-http) 明确允许 Translation 与 Notes AI/共用 AI provider 使用公网 HTTP，但所有配置入口必须持续告知明文风险。 |
| 6   | settings 丢失更新与损坏恢复     | 正确     | revision、原子写、备份恢复之外，本轮增加可审计路径操作，冲突后不重放旧整 section。                                                                                                                                                                 |
| 7   | 虚假的 DNS/IPv6/WebRTC 通过     | 正确     | 未实测项目只显示“未检测”；真实泄漏检测没有伪装成已完成。                                                                                                                                                                                           |
| 8   | 翻译/代理检测跨标签污染         | 正确     | 按 kind、tab、generation 隔离并实际取消旧请求；本轮再增加 principal 切换清空。                                                                                                                                                                     |
| 9   | 删除环境产生幽灵记录            | 正确     | 删除使用稳定环境 ID 的路径操作，并延迟清理 partition。                                                                                                                                                                                             |
| 10  | 线路切换保留旧健康结果/名称失控 | 正确     | 健康结果失效、受控名称保存/回滚已覆盖。                                                                                                                                                                                                            |
| 11  | 健康预检前创建 workspace        | 正确     | 线路解析与健康检查先于创建；本轮把 generation 检查贯穿每个异步边界与副作用前。                                                                                                                                                                     |
| 12  | Accessibility debugger 长期保持 | 正确     | 已按 attach 所有权清理并关闭。                                                                                                                                                                                                                     |
| 13  | 端口冲突与 sender 假就绪        | 正确     | bind 探测、全部监听端口 ready、进程提前退出均有测试。                                                                                                                                                                                              |
| 14  | 服务端静默丢弃/回退线路         | 正确     | 严格整批校验、候选备份后原子替换、损坏隔离与最近有效备份恢复。                                                                                                                                                                                     |
| 15  | 窄窗口翻译侧栏挤压网页          | 正确     | 隔离 Electron 截图矩阵验证无外层横向溢出；真实站点仍需人工复核。                                                                                                                                                                                   |
| 16  | 工具栏拥挤                      | 正确     | 动态内容截断、隐藏/恢复和响应式矩阵已验证。                                                                                                                                                                                                        |
| 17  | 标签语义和键盘支持不足          | 正确     | `tablist/tab/aria-selected`、方向键与 Home/End 已覆盖。                                                                                                                                                                                            |
| 18  | 全局 Escape 干扰编辑            | 正确     | 仅在存在隐藏区域且目标非可编辑控件时处理。                                                                                                                                                                                                         |

### Follow-up 阻断项与高优先级项

| 项                                                               | 判断                 | 本轮结论                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分支缺少 `ee35030`                                               | 正确                 | 已在新分支 clean cherry-pick，保留后续安全修复。                                                                                                                                                                                                                                              |
| A 远程 HTTP 契约不一致                                           | 正确                 | `allowRemoteHttp` 由 Notes AI 和远程 Translation 显式传入；offline 仍严格回环。Translation 和 Notes AI 配置入口共用同一风险判断与警告。HTTP/HTTPS 私网、metadata、special-use 及 DNS 任一危险结果均拒绝；连接地址 pinning 和 HTTPS SNI 保留。实现不跟随重定向，因此不新增可绕过的重定向路径。 |
| B principal 级隔离                                               | 正确                 | principal 绑定服务器 base URL（保留 path）与服务端确认的精确 username，再生成不泄露原文的 SHA-256 标识；设置、普通/高级 partition、翻译状态和请求均隔离。旧数据只在保存的 server/username 能精确归属时迁移，否则保留为 unowned 且不暴露，不删除用户数据。                                     |
| C 同 section 并发更新                                            | 正确                 | `advancedAi`/`translation` 使用严格白名单路径操作；环境按稳定 ID 更新。冲突重试重放语义操作而非旧快照；禁止函数及 `__proto__`/`constructor`/`prototype`。                                                                                                                                     |
| D generation 主进程副作用                                        | 正确                 | 所有相关 workspace IPC 携带 kind、environmentId、generation；开始、每次 await 后及 create/close/switch/load/proxy 前后验证。deferred race 和 Electron stale ensure 均证明旧 A 不会重建 workspace。                                                                                            |
| E sender 最终授权边界                                            | 正确                 | 普通 airport 只有在最终授权集合包含 `internal-airport` 时可启动；撤权后本地残留 outbound 不生效；unified 保持独立。                                                                                                                                                                           |
| F Notes AI 同步抛错/正文上限                                     | 正确                 | `requestImpl` 同步异常进入单 terminal error 并清理 live map；非 2xx 正文限制 64 KiB；取消和 timeout 不重复终止。                                                                                                                                                                              |
| G safeStorage 不可用即明文                                       | 部分正确             | 不采用会破坏 Linux/开发环境的强制退出。状态明确区分 `encrypted` 与 `plaintext-compatibility`，登录 UI 明示本机风险，导出仍脱敏。兼容模式并非安全凭据存储保证，仍是残余风险。                                                                                                                  |
| H CORS、uncaughtException、首管理员、JSON/SQLite、Chromium flags | 正确但本轮不采纳扩面 | 均属长期架构/部署项，涉及服务端兼容、生命周期或存储迁移，无法在本轮小范围验证，不以无测试改动冒充修复。                                                                                                                                                                                       |
| I npm audit 基线                                                 | 正确                 | 未运行 `npm audit fix --force`，未升级 electron-builder 主版本；仅记录实际基线。                                                                                                                                                                                                              |

## 关键实现

### Principal 隔离与迁移

- principal 使用 HTTP(S) server base URL 和服务端登录结果确认的精确 username。base URL 只去除根路径或末尾多余斜线，保留有效 path；username 不做小写或 Unicode 归一化，再生成不泄露原文的 SHA-256 标识。
- `advancedAi` 、`translation` 及其共用的 Notes AI provider 按 principal 保存；A/B/A 切换各自恢复自己的设置。
- 普通 GPT/Claude/Gemini 与高级环境 partition 均包含 principalId，Cookie、LocalStorage、IndexedDB 不跨协作账号复用。
- principal 切换会取消主进程翻译与 Notes AI 流、关闭旧 workspace、重置 renderer 翻译/Notes AI 运行态并使旧 generation 失效。
- 环境删除、浏览数据清理、资料重建和指纹采集会在异步边界复核 principal；账号变化后不得把旧响应或清理失败队列写入新账号。
- 旧配置只有在本机保存的 `collab.server_url + last_username` 可确定 owner 时归属该 principal；无可靠 owner 时保留在 `unowned`，不会分配给下一位登录用户。

### 路径级设置操作

- IPC 仅接受 JSON 数据操作，不接受可执行函数。
- `advancedAi` 允许 `enabled`、`activeByKind.<kind>`、`environments.<id>` 及其 `name/routeId`；`translation` 只允许已知 provider 字段。
- 新增、删除、改名、换线和激活环境互不覆盖；translation 不同嵌套 provider 字段也能在 revision 冲突后同时保留。
- 每段路径限制字符与长度，并拒绝 prototype pollution 关键字。

### 端点和请求安全

- Notes AI/共用 AI provider 与远程 Translation 默认 endpoint 为空；均允许公网 HTTP/HTTPS，非回环 HTTP 在所有相关配置入口持续显示内容和接口密钥明文传输警告。详见 [PD-001](PRODUCT_DECISIONS.md#pd-001远程-translation-与-notes-ai-接口允许公网-http)。
- offline 翻译仅允许精确回环地址。
- 所有 DNS 结果必须为公网地址；私网、回环、链路本地、metadata、保留/特殊用途地址一律拒绝。
- 请求连接使用已校验地址 pinning；HTTPS 保留原 hostname 作为 SNI。当前客户端不跟随 HTTP 重定向。
- Notes AI 非 2xx 错误正文最多读取 64 KiB，同步构造错误、取消、timeout 都只产生一次 terminal 事件。

### Generation 与最终授权

- `ai-tabs:list/create/switch/close`、`ai:ensure`、环境删除/检测、同步 host、导航、proxy check、query tracker 与页面翻译捕获均携带环境上下文。
- 主进程对旧 generation fail-closed，不能仅依赖 renderer 忽略旧返回。
- sender 最终配置构建再次核验 ordinary airport 的 `internal-airport` 授权，防止撤权后使用本地残留配置。

## 自动化验证

以下均使用临时 userData、临时账号和回环 mock；阻断非本地网络：

- `npm test`：154 passed、1 skipped、0 failed；skip 为当前平台测试进程未提供 bundled sing-box。
- `npm --prefix src/renderer-next test`：37 passed、0 failed（包含登录权限、generation 与路径级操作专项测试）。
- `npm --prefix src/renderer-next run build`：通过；仅保留 Vite 既有 chunk/dynamic-import warning。
- `npm --prefix admin_console/ui run build`：通过。
- `npm run typecheck:main`：通过。
- `npm run lint`：0 error、51 个历史 warning。
- `npm run format:check`、`git diff --check`：通过。
- `npm run verify:ai-review-ui`：通过。使用只读既有 bundled sing-box 二进制和临时配置；验证高级 A/B/A 环境持久化、翻译敏感配置隔离、Cookie/LocalStorage partition 隔离、普通账号可使用完整翻译流程但无法管理高级环境或继承托管线路，以及 A 等待后切 B 时旧 ensure 在创建 workspace 前被拒绝。
- `npm run verify:browser-privacy-ui`：通过。未访问真实 AI 网站，非本地请求为 0。

Electron 截图矩阵覆盖 `860x620`、`1024x640`、`1440x900`；人工检查无文本遮挡、裁切和外层横向溢出。测试页面显示被阻断的外部 GPT 地址属于预期网络隔离结果。

## 依赖审计基线

2026-08-26 实测：

- renderer：0 vulnerabilities。
- 根项目：10 项（9 high、1 critical）；完整建议包含 electron-builder 24 到 26 的破坏性升级。
- admin console：2 high（`nanoid`、`postcss` 构建链）。
- collab server：0 vulnerabilities。

本轮未执行 `npm audit fix --force`，也未做未经验证的打包工具链主版本升级。

## 残余风险与人工验收

- safeStorage 不可用时仍有 `plaintext-compatibility` 模式；UI 已明确告警，但共享设备不应启用记住密码，敏感配置仍应避免长期保存。
- 需使用当前管理员下发配置验证三个 ChatGPT 环境仍绑定 `internal-unified`，Claude 仍绑定管理员指定独立线路。本轮 mock 没有改写真实绑定。
- 需在真实出口环境验证 expected IP、DNS detour、IPv6 和 WebRTC；未实现的检测继续显示“未检测”。
- 需在真实 GPT/Claude 页面补充完整缩放与站点兼容视觉检查；自动化没有登录真实账号。
- CORS 白名单、uncaughtException 生命周期、首管理员 setup token、JSON/SQLite 迁移及 Chromium 全局 flags 仍需独立设计和回归计划。
- 根项目与 admin 构建工具链漏洞仍待单独升级验证，不能视为本轮已消除。
- CI 的 `push` 监听 `main` 与 `codex/release-*`，PR 也会触发；远端 CI 只有在当前本地候选提交 push 后才具有证明力。本地候选在用户完成效果验收前不 push，因此当前本地门禁结果不能冒充最终远端 CI。
