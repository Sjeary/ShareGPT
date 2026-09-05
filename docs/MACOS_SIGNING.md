# macOS 签名与公证

## GitHub 公开发布

公开 DMG 只允许由 `.github/workflows/release.yml` 生成。需要以下 GitHub Secrets：

**v1.0.9 兼容发布例外：** 本版沿用历史分发方式，不提供 Developer ID 签名和 Apple 公证。工作流从发布源码重新构建，复用底层 ad-hoc 签名工具并验证最终 DMG 内的应用；不上传本机已安装应用或旧候选。首次打开可能被 Gatekeeper 拦截，具体提示及操作边界见 Release 说明。此例外只匹配 `v1.0.9`，不自动适用于后续版本。以下凭据要求适用于正式签名路径。

- `MACOS_DEVELOPER_ID_P12`
- `MACOS_DEVELOPER_ID_PASSWORD`
- `APPLE_API_KEY_P8`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `MACOS_TEAM_ID`（Developer ID 证书的 Team Identifier，用于固定发布者身份）

构建配置使用 `com.sjeary.sharegpt.desktop`、hardened runtime 和 electron-builder 24 支持的 `mac.notarize: true`。工作流会把已签名应用及 DMG 内应用的 Team Identifier 与 `MACOS_TEAM_ID` 精确比较，并对最终 DMG 显式执行 `notarytool submit --wait`、`stapler`、`spctl`，挂载 DMG 后重新检查 bundle ID、签名和 Gatekeeper。任何一步失败，publish job 都不会运行。

## 本地连续性测试

本地 ad-hoc 签名只用于同一台 Mac 上测试覆盖安装、Keychain 与用户数据连续性：

```bash
npm run dist:mac:sender:local
```

该命令显式覆盖 `mac.notarize=false` 和 `mac.hardenedRuntime=false`，再用 ad-hoc 身份签署 `.app`。它不创建证书、不访问钥匙串，也不应要求用户输入密码。入口脚本在 `CI=true` 时拒绝运行。本地产物没有 Apple 公证，不得作为已公证产品或直接上传 GitHub Release。v1.0.9 的独立发布入口有精确版本检查，在 CI 中重新构建后调用相同的底层签名工具，不复用本机测试产物。

`npm run verify:signing-boundaries` 会阻止常见秘密文件或私钥内容被跟踪。正式发布身份只允许由 GitHub Secrets 注入公开发布工作流。
