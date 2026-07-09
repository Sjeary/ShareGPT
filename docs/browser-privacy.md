# 网页隐私与环境（v1.0.5）

## 产品边界

- ChatGPT、Gemini、Claude 使用三个独立持久化分区；只能逐个清理，不提供“全部清除”。
- 清理前由主进程调用协作服务器复核当前账号密码。密码只用于这次 HTTPS/HTTP 请求，不写入设置或日志。
- 清理的是本机 Chromium 网站数据，不能删除服务商已经保存在服务器上的账号或风控记录。
- 跨设备只同步环境策略；Cookie、密码、网页登录态、出口 IP、节点派生的时区/位置、本机清理时间和代理凭据不上传。
- 防泄漏使用 Electron 原生 WebRTC 策略和权限控制，不伪造操作系统/硬件信息，不注入 Canvas/WebGL 随机噪声，也不承诺隐藏代理属性。

## 数据清理顺序

1. 关闭目标服务的全部 `WebContentsView`，等待 `destroyed`。
2. 关闭该 Session 的在途连接。
3. 清除 Cookie、Filesystem、IndexedDB、LocalStorage、Shader Cache、WebSQL、Service Worker、Cache Storage 和临时配额。
4. 清除 HTTP 认证、网络、代码和 DNS 缓存，再 flush。
5. 只重置目标服务的 `last_url`；其它 AI 分区与 ShareGPT 业务数据不动。

Electron 31.7.7 在 macOS 上调用 `session.clearData()` 清理含 Service Worker 的已关闭分区会发生原生崩溃。当前实现使用逐项 `clearStorageData()` 加独立缓存 API；本地 Chromium 回归测试覆盖这些数据类型。

## 环境配置

- `system`：不覆盖本机语言、时区或位置。
- `us`：使用 `en-US` 和用户选择的美国 IANA 时区；不提供地理位置。
- `proxy`：两条独立检测链路确认同一出口 IP 后，采用该 IP 对应的 IANA 时区和城市级经纬度。
- 跨设备进入 `proxy` 模式时不会套用另一台设备的检测结果；每台设备必须手动同步，或显式开启代理启动后自动同步。
- 地理位置默认关闭；只有 `proxy + geolocationMode=proxy` 且检测数据完整时才授权主站读取。
- 所有 AI `WebContents` 使用 `disable_non_proxied_udp`，阻止 WebRTC 绕过代理走 UDP。

## 用户提示与开发信息

- 用户界面只展示可行动的信息：清理范围、不可恢复提示、密码错误、出口地区、时区和同步状态。
- 原始错误栈、自测步骤、CDP 命令和存储清理阶段只出现在开发命令/日志中，不展示给普通用户。
- 自动出口同步失败时保持旧配置且不弹后台噪声；手动同步时才展示具体错误。

## macOS 自测

```bash
npm test
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

`verify:browser-privacy-ui` 会构建界面，再启动临时协作服务器和隔离的 Electron 用户目录；它验证三个独立清除入口、无“清除全部”、错误密码拒绝和正确密码按服务清除。测试将非本地请求全部阻断，也不会创建 AI 网页标签。

Windows 需要在 Windows 构建机上重复同一脚本，并补 NSIS 安装包与真实代理节点切换回归；不以 macOS 结果代替 Windows 结论。
