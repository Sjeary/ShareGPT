# 网页隐私、可见信息表盘与资料环境（v1.0.6）

## 产品边界

- ChatGPT、Gemini、Claude 使用三个独立持久化分区；只能逐个清理，不提供“全部清除”。
- 清理前由主进程调用协作服务器复核当前账号密码。密码只用于这次 HTTPS/HTTP 请求，不写入设置或日志。
- 清理的是本机 Chromium 网站数据，不能删除服务商已经保存在服务器上的账号或风控记录。
- 跨设备只同步环境策略和可选的指纹标准化策略；Cookie、密码、网页登录态、出口 IP、节点派生的时区/位置、本机资料 ID、网页审计快照、清理时间和代理凭据不上传。
- 防泄漏使用 Electron 原生 WebRTC 策略和权限控制；指纹标准化默认关闭，启用后使用按本机资料 ID 稳定的值，不在每次加载时随机变化。
- 本功能用于检查并减少明显矛盾，不承诺隐藏代理、绕过服务商风控或让不同物理设备绝对不可区分。

## 数据清理顺序

1. 关闭目标服务的全部 `WebContentsView`，等待 `destroyed`。
2. 关闭该 Session 的在途连接。
3. 清除 Cookie、Filesystem、IndexedDB、LocalStorage、Shader Cache、WebSQL、Service Worker、Cache Storage 和临时配额。
4. 清除 HTTP 认证、网络、代码和 DNS 缓存，再 flush。
5. 只重置目标服务的 `last_url`；其它 AI 分区与 ShareGPT 业务数据不动。

“重建资料环境”在完成上述清理后，还会为目标服务生成新的本机资料 ID，并切换到新的持久化分区。旧分区不再挂载，但其它 AI 服务仍保持原分区和登录状态。

Electron 31.7.7 在 macOS 上调用 `session.clearData()` 清理含 Service Worker 的已关闭分区会发生原生崩溃。当前实现使用逐项 `clearStorageData()` 加独立缓存 API；本地 Chromium 回归测试覆盖这些数据类型。

## 环境配置

- `system`：不覆盖本机语言、时区或位置。
- `us`：使用 `en-US` 和用户选择的美国 IANA 时区；不提供地理位置。
- `proxy`：两条独立检测链路确认同一出口 IP 后，采用该 IP 对应的 IANA 时区和城市级经纬度。
- 跨设备进入 `proxy` 模式时不会套用另一台设备的检测结果；每台设备必须手动同步，或显式开启代理启动后自动同步。
- 地理位置默认关闭；只有 `proxy + geolocationMode=proxy` 且检测数据完整时才授权主站读取。
- 所有 AI `WebContents` 使用 `disable_non_proxied_udp`，阻止 WebRTC 绕过代理走 UDP。

## 网页可见信息表盘

- 采集在当前已打开的 ChatGPT、Claude 或 Gemini 页面上下文中执行，因此展示的是该页面实际读取到的值，而不是只展示设置中的目标值。
- 网络摘要包含出口 IP、ASN、组织、国家/地区和出口时区；页面摘要包含语言、时区、UA、Client Hints、平台、CPU、内存、屏幕、DPR、触控、WebGL/GPU、Canvas、Audio、字体、媒体设备计数和本地 WebRTC 候选状态。
- Canvas 和 Audio 只保存 SHA-256 摘要；字体只检测固定白名单；媒体设备只保存数量及“标签是否可见”，不保存设备 ID、标签文本、原图或音频样本。
- 清除或重建前自动保存一份 `beforeClear` 摘要；清除后重新打开网页并刷新表盘，即可比较 19 个字段。
- Mac / Windows 差异比较采用手动导出/导入 JSON，不自动上传网页指纹快照；导入数据只存在当前界面内存中。

## 可选稳定指纹标准化

- 默认关闭，关闭时不修改网页看到的操作系统、硬件、Canvas、Audio 或媒体设备信息。
- `balanced` 保留真实 OS/UA/WebGL 和媒体设备，只把 CPU、内存档位、屏幕、DPR、触控以及 Canvas/Audio 摘要稳定到当前资料环境。
- `us-windows` 额外统一 Windows UA/Client Hints、平台、Intel WebGL 摘要，并向网页返回空的媒体设备列表；语言、时区和出口 IP 仍由“环境配置”和实际代理节点决定。
- 同一资料 ID 会生成稳定的 Canvas/Audio 微小扰动；执行“重建资料环境”后资料 ID 和持久化分区都会轮换。
- 标准化不是完整浏览器虚拟机：TLS/网络栈、Electron/Chromium 行为、真实出口信誉及网站服务端历史仍可能关联设备或账号。

## 用户提示与开发信息

- 用户界面展示清理范围、不可恢复提示、密码错误、出口地区、时区、同步状态、网页可见摘要和可行动的环境矛盾。
- 原始错误栈、自测步骤、CDP 命令和存储清理阶段只出现在开发命令/日志中，不展示给普通用户。
- 自动出口同步失败时保持旧配置且不弹后台噪声；手动同步时才展示具体错误。

## macOS 自测

```bash
npm test
npx electron src/main/test/browserFingerprint.electron.js
npm run verify:browser-privacy
npm run verify:browser-privacy-ui
npm run format:check
npm run lint
npm run typecheck:main
npm --prefix src/renderer-next run build
```

`verify:browser-privacy` 只启动 `127.0.0.1` 测试页，不会访问 ChatGPT、Gemini 或 Claude。它会在真实 Electron/Chromium 中验证：

- `Intl` 时区、`navigator.language`、`Accept-Language`；
- 可选出口位置和关闭位置后的拒绝行为；
- WebRTC 策略和本机 IP 不出现在 ICE candidate；
- Cookie、LocalStorage、IndexedDB、Cache Storage、Service Worker 的写入与删除；
- 清理一个分区后，另一个模拟 AI 分区保持不变。

`verify:browser-privacy-ui` 会构建界面，再启动临时协作服务器和隔离的 Electron 用户目录；它验证三个独立清除/资料重建入口、无“清除全部”、错误密码拒绝、正确密码按服务清除与重建、表盘可见，以及同步载荷包含标准化策略但不包含本机资料 ID/审计快照。测试将非本地请求全部阻断，也不会创建 AI 网页标签。

`src/main/test/browserFingerprint.electron.js` 使用隔离的隐藏 Electron 页面验证标准化后的 UA/平台、CPU、内存、屏幕、媒体设备以及 Canvas/Audio 摘要，不访问任何 AI 网站。

Windows 需要在 Windows 构建机上重复同一脚本，并补 NSIS 安装包与真实代理节点切换回归；不以 macOS 结果代替 Windows 结论。
