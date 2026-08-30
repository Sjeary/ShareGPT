# macOS 签名与公证

## GitHub 公开发布

公开 DMG 只允许由 `.github/workflows/release.yml` 生成。需要以下 GitHub Secrets：

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

该命令显式覆盖 `mac.notarize=false` 和 `mac.hardenedRuntime=false`，再用 ad-hoc 身份签署 `.app`。它不创建证书、不访问钥匙串，也不应要求用户输入密码。脚本在 `CI=true` 时拒绝运行。本地产物没有 Apple 公证，不得上传 GitHub Release 或交付给其他用户。

`npm run verify:signing-boundaries` 会阻止常见秘密文件或私钥内容被跟踪。正式发布身份只允许由 GitHub Secrets 注入公开发布工作流。
