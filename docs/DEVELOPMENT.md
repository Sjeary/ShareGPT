# Windows 与 macOS 开发

客户端使用 Electron，协作服务端和管理控制台分别位于 `collab_server2/` 与 `admin_console/`。日常开发使用同一份 Git 仓库，通过 GitHub 同步源码；各台电脑根据锁文件安装自己的依赖。

## 首次准备

安装 Git 和 Node.js 22.12+（CI 使用 Node 22，支持的更新版本也可用），然后执行：

```sh
git clone https://github.com/Sjeary/ShareGPT.git
cd ShareGPT
npm run setup:dev
npm run dev
```

Windows PowerShell、macOS 终端均可使用这些命令。`setup:dev` 会按四个锁文件安装客户端、客户端界面、管理端界面和服务端依赖，下载 Electron，并从官方 GitHub Release 下载和校验当前平台的 sing-box。自动资源准备支持 Windows x64 和 Apple Silicon Mac；其他平台的资源要求见 [build/bin/README.md](../build/bin/README.md)。

已有完整环境时，直接运行 `npm run dev`。检查依赖、Electron 和代理二进制可运行 `npm run doctor`；锁文件更新后重新运行 `npm run setup:dev`。

`npm run dev` 构建界面后启动客户端。开发资料默认保存在当前检出的 `.cache/user-data`，与正式安装版分离。切换电脑需要重新登录；macOS 钥匙串和 Chromium 加密登录态不能直接复制成 Windows 登录态。

## 在两台电脑之间接续

开始工作前，在工作区干净时拉取：

```sh
git pull --ff-only
```

完成一段工作后，检查并提交明确的源码文件，然后上传：

```sh
git status
git diff
git add <本次修改的源码文件>
git commit -m "fix(client): 描述本次修改"
git push
```

另一台电脑再执行 `git pull --ff-only` 即可接续。若本地有未提交修改，先保存为提交再拉取；若两台都产生了独立提交，先检查差异并整合，不要强制推送覆盖历史。需要独立审阅的功能使用单独分支。

`node_modules/`、`.cache/`、安装包、代理二进制、真实配置与登录资料均不作为源码同步。不要复制 Mac 的依赖到 Windows；原生终端、Electron 和构建工具包含平台专用文件。仓库通过 `.gitattributes` 统一源码行尾，避免跨平台切换产生无关修改。

## 本地检查

```sh
npm test
npm run typecheck:main
npm run build:next
npm --prefix admin_console/ui run build
```

完整门禁和行为验收见 [贡献指南](../.github/CONTRIBUTING.md)。普通 Electron 行为验收使用隔离资料和隐藏窗口。Windows 终端 UI 与 macOS 原生全屏等需要一次性系统环境的检查交给 CI 执行。

## 云端跨平台测试

仓库已有 [GitHub Actions CI](../.github/workflows/ci.yml)。推送 `main`、提交 Pull Request，或在仓库 **Actions → CI → Run workflow** 手动选择分支后，会在独立云端机器执行：

- Ubuntu：源码、类型、格式、单元测试和协议兼容性。
- macOS：真实 Electron 界面、生命周期、原生全屏、终端和打包启动/升级检查。
- Windows：原生终端、Electron 行为、NSIS 构建，以及实际安装、启动和升级检查。

查看本次提交对应的 [Actions 运行结果](https://github.com/Sjeary/ShareGPT/actions/workflows/ci.yml)。无需启动个人 Mac，也不需要在 Windows 上虚拟化 macOS。Docker、浏览器设备模拟和静态检查不能替代 macOS 钥匙串、Windows ConPTY 或安装器的系统行为。

普通 CI 不上传新版本供用户更新；[发布工作流](../.github/workflows/release.yml)由 `v*` 标签单独触发。云端运行器为临时环境，使用合成测试账号和资料；真实第三方网页登录及个人数据连续性仍须单独验证。

GitHub 官方说明：[托管运行器](https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners)、[手动运行工作流](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/manually-running-a-workflow)。
