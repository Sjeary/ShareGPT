# 发布流程（每次更新前的参考清单）

本文是「每次要发新版本时照着做」的清单：版本号、更新日志、打包、CI、发布与自动更新。
面向维护者；普通使用者无需阅读。

## 更新与自动更新是怎么工作的

- **自动更新源 = GitHub Releases**，不经过任何自建服务器。界面显示的最新版只取
  `https://github.com/<owner>/<repo>/releases/latest` 最终跳转到的 tag；`latest.yml`
  只描述 Windows 安装包，且其中版本必须与该 tag 完全一致。这样旧的或错误的
  `latest.yml`（例如曾出现的 `6.0.0`）不能再改变界面版本号。
- **Windows**：用 NSIS 安装包 + `latest.yml` 做 electron-updater 原地无感更新
  （后台下载、自动安装并重启，账号 / 聊天记录 / 网页登录态保留）。
- **macOS**：目前为「提示下载安装包」方式（dmg）。
- 正式桌面身份在两个平台都固定为 `com.sjeary.sharegpt.desktop`。`sender` 只是运行入口，
  不是第二个产品身份，也不得再写入 bundle identifier、可执行文件名或正式产物名。
- 仓库地址从 `package.json` 的 `homepage` / `repository` 推导，fork 后改这两项即指向自己的仓库。

## 必需更新 vs 可选更新

目前**没有强制更新机制**——是否「必须升级」靠更新日志/Release notes 告知用户。

- **可选更新**：体验优化、非阻断性小修复 → 在 CHANGELOG 顶部用一行 `> 可选更新：…` 标注。
- **建议/必需更新**：影响可用性、安全或与服务端不兼容的改动 → 在 Release notes 醒目说明。

## 发布清单

### 1) 改完代码，本地跑一遍 CI 等价校验（必须全绿）

CI（`.github/workflows/ci.yml`）只做校验、**不打包**。本地等价命令（仓库根目录）：

```bash
npm run format:check          # prettier 全仓格式检查
npm run lint                  # eslint（Node 端）
npm run typecheck:main        # 主进程 checkJs
npm test                      # collab_server2 单元测试
node --check src/main/*.js    # 主进程语法
node --check collab_server2/server.js
npm --prefix src/renderer-next run build   # 渲染层 tsc -b + vite build
npm --prefix admin_console/ui run build    # 管理端（如有改动）
```

### 2) 升级版本号

- **唯一真源**：根 `package.json` 的 `version`（`app.getVersion()` 读它，安装包名 `sharegpt-${version}.exe` 也用它）。
- 同步：
  - `src/renderer-next/src/components/layout/Sidebar.tsx` 里侧栏底部的兜底版本串（仅在 `meta.version` 缺失时显示）。
  - 遵循 [语义化版本](https://semver.org/lang/zh-CN/)：修 bug → patch（1.0.0→1.0.1）；加功能且兼容 → minor；不兼容 → major。
- 注意：`admin_console` 有自己的版本号，与主程序独立，不要一起改。
- 执行 `npm run verify:release-contract`，确认 `package.json`、`package-lock.json`、tag、
  bundle identifier 和产物名属于同一个版本。tag 构建时使用
  `SHAREGPT_RELEASE_TAG=vX.Y.Z npm run verify:release-contract`。

### 3) 写更新日志（两处都写）

- `CHANGELOG.md`：[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，新增 `## [X.Y.Z] - YYYY-MM-DD`，
  分 `新增 / 变更 / 修复 / 备注`；可选更新加 `> 可选更新：…`；并更新底部 `[Unreleased]` 与 `[X.Y.Z]` 链接。
- `src/renderer-next/src/components/panels/account/changelog.ts`：应用内「更新日志」区，数组**顶部**追加一条，
  2–4 句面向用户的要点（详细以 GitHub Release notes 为准）。

### 4) 打包

> **正式 Windows Release 只能使用 `dist:win:installer`。** `dist:win` 是 portable
> 自测包；它同样是完整封装的单文件 EXE，但不是安装包，不生成自动更新所需的
> `latest.yml` / `.blockmap`。两条命令默认写入同名 `sharegpt-<version>.exe`，所以最后执行的
> 命令决定该文件究竟是哪一种，不能只看文件名。

```bash
# Windows 便携版（快速本地自测，无 latest.yml、不参与自动更新）
npm run dist:win              # → release/sharegpt-<version>.exe

# Windows 安装版（NSIS，含 latest.yml，自动更新用这个）
npm run dist:win:installer    # → release/ 下 nsis 安装包 + latest.yml

# macOS 本机预览（稳定本机证书，只供当前开发 Mac）
npm run dist:mac:sender:local # → release_sender/mac-arm64/ShareGPT.app

# macOS 正式包（必须提供 Developer ID 与 notarization 凭据）
npm run dist:mac              # → release_sender/sharegpt-<version>-arm64.dmg/zip
```

- 二进制依赖 `build/bin/`（sing-box、frpc），由 `prepare-assets` 校验/准备。
  本地 Windows 构建可以不签名，用于编译和功能验收。互联网 GitHub Release 不应使用
  未签名、自签名或 ad-hoc 产物：Windows 应使用受信任的 Authenticode 证书并带时间戳；
  macOS 应使用 Apple Developer ID Application、Hardened Runtime 和 notarization。

GitHub Actions 的正式签名凭据只放仓库 Secrets，不写入代码、构建产物或普通环境文件：

- Windows：`WINDOWS_CODE_SIGNING_PFX`、`WINDOWS_CODE_SIGNING_PASSWORD`；正式流水线执行
  `dist:win:release` 并强制签名，随后检查安装器和主程序 Authenticode 及时间戳。
- macOS：具体 Secrets 与校验见 `docs/MACOS_SIGNING.md`。

`.github/workflows/release.yml` 同时等待 Windows 与 macOS。两个构建 job 只上传内部
Actions artifacts；最终 job 验证六个文件完整后先创建 draft，全部上传成功才公开，避免
Latest 提前指向只有单个平台安装包的残缺版本。

#### Windows 产物身份与体积验收

`1.0.6` 同一提交、同一 `win-unpacked` 内容的实测对照如下；数值只作为本次诊断基线，
后续版本会随代码和二进制更新变化：

| 目标        | 命令                         |        字节 | Windows 显示 | 自动更新文件                   |
| ----------- | ---------------------------- | ----------: | -----------: | ------------------------------ |
| portable    | `npm run dist:win`           |  92,114,714 |    87.85 MiB | 无                             |
| NSIS 安装包 | `npm run dist:win:installer` | 102,559,502 |    97.81 MiB | `latest.yml` + `.exe.blockmap` |

因此“比上一版小约 10 MiB”首先要核对目标类型，不能直接判定为漏文件。portable 仍包含
`app.asar`、`sing-box.exe` 和 `frpc.exe`；它缺少的是安装/卸载与 electron-updater 的 NSIS
发布层。正式发布前在 Windows 构建机执行：

本次检查还发现 `win-unpacked/resources/bin/sing-box`（无 `.exe`）是约 34 MB 的非 Windows
冗余文件，因为 `extraResources` 当前会复制整个 `build/bin`。它不影响功能，也进一步说明此次
小包不是漏掉 Windows 核心资产。以后若清理跨平台冗余，必须单独提交、重新验证并更新这里的
体积基线，不能把预期缩小误判为构建缺失。

```bash
npm run dist:win:installer
npm run verify:release-win
```

`verify:release-win` 必须返回 `target: "nsis"` 和 `ok: true`。它会检查：

- 安装包、`latest.yml`、`.exe.blockmap` 均存在且版本/文件大小相互匹配；
- `win-unpacked/resources/app.asar` 存在；
- `sing-box.exe`、`frpc.exe` 已进入安装内容，且 SHA-256 与固定清单一致。

若同一目录还要保留 portable，请在构建 NSIS 前把它明确改名为
`sharegpt-<version>-portable.exe`；不要让 portable 覆盖正式安装包。

### 5) 推送代码 + CI

- 推送到 `main` 或开 PR；CI 自动跑第 1 步的校验。确保绿。

### 6) 发布 GitHub Release（实际让用户能更新的一步）

1. 先合并已通过 CI 和代码审查的固定提交，再打 tag：`git tag vX.Y.Z && git push origin vX.Y.Z`。
2. 在 GitHub 新建 Release，选该 tag，**上传**：
   - Windows NSIS 安装包（`.exe`）+ `latest.yml` + 对应的 `.exe.blockmap`；
   - macOS 正式 `.dmg` / `.zip`。正式名为 `sharegpt-<version>-arm64.*`；1.0.x 期间额外上传
     内容完全相同的 `sharegpt-sender-<version>-arm64.dmg` 兼容别名，仅供已发布的
     1.0.7/1.0.8 macOS 客户端下载升级。别名不代表另一个 bundle identity。
3. Release notes 可直接引用 `CHANGELOG.md` 对应小节；可选/必需更新在此说明。
4. 发布后检查 Latest 指向的新 tag、`latest.yml` 版本与文件名、Windows Authenticode、
   macOS Developer ID / notarization；Release 资产不得覆盖或事后替换。

## 易踩的坑

- **asar pitfall**：不要在仓库根目录 `npx asar extract-file <app.asar> package.json`——会把 `package.json` 写到当前目录、覆盖真实文件。要解到临时目录。
- `latest.yml` 必须随安装包一起上传到同一个 Release，否则自动更新读不到。
- `.exe.blockmap` 必须与安装包同版本、同名上传，否则差分更新会退化或失败。
- 便携版（portable）不产生 `latest.yml`，不能用于自动更新，仅供本地自测。
- 不要覆盖已经公开的安装包。流水线只允许在上传中断后修复尚未公开的 draft；产物已经
  公开后发现错误，必须停止发布并创建新的版本号。
