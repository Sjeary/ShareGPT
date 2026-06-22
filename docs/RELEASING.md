# 发布流程（每次更新前的参考清单）

本文是「每次要发新版本时照着做」的清单：版本号、更新日志、打包、CI、发布与自动更新。
面向维护者；普通使用者无需阅读。

## 更新与自动更新是怎么工作的

- **自动更新源 = GitHub Releases**（参考 cc-switch），不经过任何自建服务器。
  客户端读取 `https://github.com/<owner>/<repo>/releases/latest/download/latest.yml`
  比较版本（见 `src/main/backend.js` 的 `checkLatestRelease()` 与登录页 `checkGithubUpdate()`）。
- **Windows**：用 NSIS 安装包 + `latest.yml` 做 electron-updater 原地无感更新
  （后台下载、自动安装并重启，账号 / 聊天记录 / 网页登录态保留）。
- **macOS**：目前为「提示下载安装包」方式（dmg）。
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

### 3) 写更新日志（两处都写）

- `CHANGELOG.md`：[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，新增 `## [X.Y.Z] - YYYY-MM-DD`，
  分 `新增 / 变更 / 修复 / 备注`；可选更新加 `> 可选更新：…`；并更新底部 `[Unreleased]` 与 `[X.Y.Z]` 链接。
- `src/renderer-next/src/components/panels/account/changelog.ts`：应用内「更新日志」区，数组**顶部**追加一条，
  2–4 句面向用户的要点（详细以 GitHub Release notes 为准）。

### 4) 打包

```bash
# Windows 便携版（快速本地自测，无 latest.yml、不参与自动更新）
npm run dist:win              # → release/sharegpt-<version>.exe

# Windows 安装版（NSIS，含 latest.yml，自动更新用这个）
npm run dist:win:installer    # → release/ 下 nsis 安装包 + latest.yml

# macOS（在 mac 构建机上，见 memory: mac-build-machine）
npm run dist:mac              # → dmg
```

- 二进制依赖 `build/bin/`（sing-box、frpc），由 `prepare-assets` 校验/准备。
- 未签名：Windows 首次运行会触发 SmartScreen，需「更多信息 → 仍要运行」。

### 5) 推送代码 + CI

- 推送到 `main` 或开 PR；CI 自动跑第 1 步的校验。确保绿。

### 6) 发布 GitHub Release（实际让用户能更新的一步）

1. 打 tag：`git tag vX.Y.Z && git push origin vX.Y.Z`。
2. 在 GitHub 新建 Release，选该 tag，**上传**：
   - Windows NSIS 安装包（`.exe`）+ `latest.yml`；
   - （如有）macOS `.dmg`。
3. Release notes 可直接引用 `CHANGELOG.md` 对应小节；可选/必需更新在此说明。
4. 发布后，客户端下次检查即可读到 `latest.yml` 并按版本提示/更新。

## 易踩的坑

- **asar pitfall**：不要在仓库根目录 `npx asar extract-file <app.asar> package.json`——会把 `package.json` 写到当前目录、覆盖真实文件。要解到临时目录。
- `latest.yml` 必须随安装包一起上传到同一个 Release，否则自动更新读不到。
- 便携版（portable）不产生 `latest.yml`，不能用于自动更新，仅供本地自测。
