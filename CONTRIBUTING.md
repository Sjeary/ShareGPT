# 贡献指南

感谢你愿意为 ShareGPT 贡献代码或想法！本项目由三端组成：**客户端**（Electron 主进程 `src/main/` + 渲染层 `src/renderer-next/`）、**协作服务端** `collab_server2/`、**管理控制台** `admin_console/`。请先阅读 [README](README.md) 了解整体架构与定位。

> 本项目涉及网络代理，属安全敏感项目。安全漏洞**不要**走普通 issue，请按 [SECURITY.md](SECURITY.md) 私密上报。

## 环境要求

- Node.js 18+、npm。
- 第三方二进制（sing-box，必要时 frpc）按 `build/bin/README.md` 放好——**不要把二进制提交进仓库**。

## 本地跑起来

```bash
# 1. 安装依赖（主程序 + 渲染层 + 管理端 UI）
npm install
npm --prefix src/renderer-next install
npm --prefix admin_console/ui install
```

各端开发脚本（详见 `package.json` 的 `scripts`）：

```bash
# 客户端（发送端）
npm run dev:sender

# 管理控制台
npm run dev:admin

# 协作服务端（纯 Node，零外部依赖）
cd collab_server2 && node server.js
```

打包构建（如需验证产物）：

```bash
npm run dist:win:sender     # Windows 发送端（NSIS）
npm run dist:mac:sender     # macOS 发送端
npm run dist:admin:win      # 管理控制台
```

## 提交规范：Conventional Commits

仓库历史一直沿用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，请照搬这一风格：

```
<类型>(<可选范围>): <简短描述>
```

常用类型：`feat`、`fix`、`docs`、`chore`、`refactor`、`perf`、`test`、`build`、`release`。范围用括号标注受影响模块，例如：

```
feat(airport): 可选机场代理 (服务器下发节点)
fix(ai): 内嵌页禁用 QUIC/HTTP3, 修复机场模式 Cloudflare 白屏
docs(readme): 补充部署指南
```

描述用简体中文、写清「做了什么」，与现有历史保持一致。

## 提交前必过的检查

请在改动相关的端分别执行，确保通过后再提 PR：

- **渲染层**：`npx tsc -b`（在 `src/renderer-next/` 下）
- **管理控制台 UI**：`npx tsc -b`（在 `admin_console/ui/` 下）
- **主进程 / 服务端（纯 JS）**：对改动的文件跑 `node --check`，例如
  `node --check src/main/main.js`、`node --check collab_server2/server.js`
- **测试**：若涉及范围存在测试，请补充并跑通对应测试。

## PR 流程

1. **Fork** 本仓库。
2. 基于 `main` 开一个语义化命名的分支，如 `feat/xxx`、`fix/xxx`。
3. 提交（遵循上面的 Conventional Commits）。
4. 发起 **Pull Request**，按模板写清：**改了什么、为什么改、如何自测**，关联相关 issue。
5. 保持 PR 聚焦单一主题，方便审查。

## 绝对不要提交的内容

- **第三方二进制**（sing-box / frpc 等）——按 `build/bin/README.md` 本地准备。
- **任何密钥 / 凭据 / 节点配置 / 订阅链接**（如 `DEV_TOKEN`、真实端口、机场订阅）。
- **`private.defaults.local.json`** 及任何本地私有覆盖配置。
- 个人数据、用户库、聊天记录、登录态等运行期产生的文件。

提交前请确认 `git status` 干净，没有把上述内容误加进来。

## 行为准则

参与本项目即表示你同意遵守 [行为准则](CODE_OF_CONDUCT.md)。
