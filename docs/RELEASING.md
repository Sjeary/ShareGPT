# ShareGPT 桌面发布流程

## 版本与更新契约

- `package.json.version` 是构建版本真源，必须与 `package-lock.json` 两处版本一致。
- 正式身份是 `com.sjeary.sharegpt.desktop`，产品名是 `ShareGPT`。发布契约固定二者，避免升级改变 bundle 身份或 Electron 默认 userData 目录。
- 客户端更新版本只认 GitHub `/releases/latest` 的最终 tag。`latest.yml` 只服务于 Windows 包下载，不能改写 UI 版本。
- 版本、身份、文件名、签名配置与旧版别名由 `release.compatibility.json` 和 `npm run verify:release-contract` 固定。

## 合并前验证

```bash
npm ci
npm --prefix src/renderer-next ci
npm --prefix admin_console/ui ci
npm --prefix collab_server2 ci
npm run test:release
npm run verify:release-contract
npm run verify:signing-boundaries
npm run typecheck:main
npm run lint
npm run format:check
npm test
npm --prefix src/renderer-next run build
npm --prefix admin_console/ui run build
```

`.github/workflows/ci.yml` 还会在真实 Windows runner 下载固定版本的 sing-box/frpc、校验 SHA-256、构建 NSIS 并执行 `verify:release-win`。这用于覆盖 Windows 专属路径，不新增第二套更新机制。

## 正式产物

推送与 `package.json.version` 完全相同的 `vX.Y.Z` tag，触发 `Release Desktop`：

- Windows：`sharegpt-X.Y.Z.exe`、`.exe.blockmap`、`latest.yml`。
- macOS：`sharegpt-X.Y.Z-arm64.dmg`、`.zip`，以及字节一致的旧客户端别名 `sharegpt-sender-X.Y.Z-arm64.dmg`。

Windows 任务要求正式 Authenticode PFX 和 `WINDOWS_PUBLISHER_NAME`，复验安装器、unpacked exe 与 `app-update.yml` 的发布者身份、有效签名及时间戳。macOS 任务要求 Developer ID、`MACOS_TEAM_ID` 和 App Store Connect API 凭据，按 [MACOS_SIGNING.md](MACOS_SIGNING.md) 验证发布者 Team ID、签名、公证和 Gatekeeper。

### v1.0.9 / v1.0.10 历史分发方式例外

v1.0.9 与 v1.0.10 明确采用旧分发方式：Windows 使用未签名 NSIS，macOS 使用 ad-hoc 签名且未经 Apple 公证，不要求以上正式签名凭据。`scripts/release-distribution.cjs` 是版本策略入口，只有精确匹配包版本与 tag 的 `v1.0.9`、`v1.0.10` 返回 `legacy`。工作流和 `scripts/build-legacy-release.cjs` 共用这一判断；1.0.11、预发布标签及其他版本仍走正式签名路径，不能因凭据缺失自动降级。

例外不跳过源码归属、CI、行为测试、固定二进制校验、应用身份、更新元数据及资产完整性检查。Mac 应用从源码构建、签署、验证后再封装；Windows 验证安装器及主程序为预期的未签名状态。不得宣称这些版本已经公证或能在所有设备上免提示打开。公开说明使用对应的 `docs/releases/vX.Y.Z.md`，该文件在平台构建前检查存在，不使用提交记录自动生成的技术摘要。

正式 tag 的 commit 必须已经包含在 `origin/main`。两平台先只上传 Actions artifact。publish job 精确验证六个文件，创建或更新 draft，核对 GitHub 远端资产后才公开为 Latest。已公开 tag 会被拒绝覆盖。

## Windows 固定二进制

`scripts/prepare-windows-release-assets.ps1` 从官方 release 下载 `build/bin/checksums.json` 固定的 sing-box 与 frpc，按 SHA-256 验证后只放到 `build/bin` 根目录，避免同时打包根目录和 `windows/` 副本。

正式构建命令：

```powershell
./scripts/prepare-windows-release-assets.ps1
npm run dist:win:release
npm run verify:release-win
```

本地未签名 `dist:win:installer` 只用于候选验证；获准使用旧分发方式的公开包由受版本策略约束的入口在 CI 重新构建，不直接上传旧本机候选。

## 候选构建

使用干净、固定提交的构建目录，并先运行 `npm ci`。不要把整个 `node_modules` 目录链接到另一个检出后直接打包：打包器可能遗漏间接运行依赖，源码运行成功不能证明最终应用包完整。保留旧候选，在新的输出目录验证实际 ASAR 内容与运行依赖。

1.0.10 本地可按批准的版本策略构建待验收产物：准备对应平台的固定二进制后，设置 `SHAREGPT_RELEASE_TAG=v1.0.10` 并运行 `node scripts/build-legacy-release.cjs`。脚本始终禁止自动上传。这里的版本参数不代表已经创建 tag 或通过 GitHub CI。

正式发布前仍须以最终 main/tag 源码重新构建，并在隔离环境验证安装启动和从上一公开版本升级。不要在个人正在使用的数据目录中运行仅限一次性 CI 机器的安装测试。

## 发布后验收

1. GitHub Release 必须为 Latest，资产数和名称精确匹配工作流预期。
2. `/releases/latest` 最终跳转到当前 tag。
3. `latest.yml` 的 version/path/size/sha512 与 tag 和 Windows canonical 安装包精确一致，`app-update.yml` 固定 GitHub owner/repo；正式签名路径还必须固定 publisher，旧分发方式不得伪造发布者签名。
4. 从 1.0.8 安装升级，确认账号、设置、协作记录及 AI 网页登录态仍位于原 ShareGPT 数据目录。
5. Windows 自动更新遇到版本或文件名不一致时必须停止；macOS canonical 与 legacy DMG 必须 `cmp` 一致。
