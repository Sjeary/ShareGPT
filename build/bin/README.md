# Third-Party Binaries

ShareGPT 桌面客户端的代理能力需要 `sing-box`。默认开发和打包入口只准备此资源；历史接收端使用的 `frpc` 不属于当前客户端依赖。

二进制不提交到源码仓库。固定版本与 SHA-256 见 [`checksums.json`](checksums.json)。

## 准备资源

从 [sing-box 官方发布页](https://github.com/SagerNet/sing-box/releases) 下载当前平台、架构及清单指定版本，放到 `build/bin/`，或对应的 `build/bin/windows/`、`build/bin/macos/`、`build/bin/linux/`。

- Windows 文件名为 `sing-box.exe`。
- macOS / Linux 文件名为 `sing-box`，需有执行权限。
- 也可用 `SHAREGPT_SINGBOX_PATH` 指向已有文件，或用 `SHAREGPT_BIN_DIR` 指定资源目录。

```bash
npm run prepare:assets -- --required
npm run dev
```

准备脚本会核对 SHA-256。默认开发和打包均使用 `--required`，缺失或校验不符会停止。只测试界面且不启动代理时，可以在编译界面后直接运行 `npm exec -- electron .`；数据仍与正式应用隔离。

## 发布构建

Windows 的 `scripts/prepare-windows-release-assets.ps1` 从官方 Release 下载固定版本并校验可执行文件 SHA-256。macOS 的 `scripts/prepare-macos-release-assets.sh` 下载 arm64 归档，先核对归档 SHA-256，再核对可执行文件。

两者都把资源放到 `build/bin/` 根目录。当前客户端配置只打包根目录的 sing-box 可执行文件，避免把平台子目录、历史 frpc 和校验文档带进安装包。

更换二进制版本时，先核对官方来源与校验和，再更新清单中对应平台的版本和哈希。
