# Third-Party Binaries

ShareGPT 运行代理能力时依赖以下第三方程序：

- `sing-box`
- `frpc`：仅 Receiver 模式需要

源码仓库不再直接提交这些二进制文件。这样可以避免把第三方可执行文件和大体积产物放进 Git 历史。

## 下载来源
- sing-box 官方发布页：`https://github.com/SagerNet/sing-box/releases`
- frp 官方发布页：`https://github.com/fatedier/frp/releases`

## 放置方式

可以把下载后的文件放到以下任一位置：

- `build/bin/`
- `build/bin/windows/`
- `build/bin/macos/`
- `build/bin/linux/`

常见文件名：

- Windows：`sing-box.exe`、`frpc.exe`
- macOS / Linux：`sing-box`、`frpc`

macOS Sender 发行包只需要 `sing-box`，不需要 `frpc`。推荐放置方式：

```bash
mkdir -p build/bin/macos
cp /path/to/sing-box build/bin/macos/sing-box
chmod +x build/bin/macos/sing-box
```

## 环境变量方式

如果你不想把二进制放到仓库内，可以通过环境变量指定已有路径：

- `SHAREGPT_BIN_DIR`
- `SHAREGPT_SINGBOX_PATH`
- `SHAREGPT_FRPC_PATH`

## 说明

- 没有这些二进制时，应用仍然可以启动界面、登录、聊天、管理和打包
- 只有真正点击启动 Sender / Receiver 代理服务时，才会提示缺少对应二进制

