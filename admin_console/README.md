# ShareGPT Admin

独立的桌面管理端，用于连接 `../collab_server2` 协作服务并完成这些操作：

- 初始化管理员并登录管理后台；
- 创建、停用和编辑用户，管理聊天、高级 AI 与线路授权；
- 维护团队网络配置、内置代理线路及 ChatGPT/Gemini/Claude 推荐线路；
- 配置由服务端加密保存的托管翻译 API、用户授权和用量统计；
- 查看用户反馈和漏走代理域名；
- 维护版本信息与 `client_bootstrap.json` 备用扩展配置。

## 启动

在仓库根目录可以直接运行：

```bash
npm run dev:admin
```

或进入管理端目录运行：

```bash
npm install
npm run dev
```

## 打包

```bash
npm run dist:win
npm run dist:mac
```

在仓库根目录也可以运行：

```bash
npm run dist:admin:win
npm run dist:admin:mac
```

Windows 会生成便携版，macOS 会生成 DMG。管理端不依赖 `sing-box`、`frpc` 或客户端运行资源。

## 服务端要求

管理端与协作服务端应来自同一个已验证的 tag 或提交。服务端默认只监听 `127.0.0.1`，生产环境应通过 HTTPS 反向代理访问；完整步骤见 [`../docs/SELF_HOSTING.md`](../docs/SELF_HOSTING.md)。托管翻译还要求服务端设置 `SHAREGPT_TRANSLATION_MASTER_KEY`。

首次部署时有两种方式创建管理员：

1. 直接在管理端登录页点击“首次初始化管理员”
2. 或在服务器上执行：

```bash
node add_user.js <username> <password> [avatar] --admin
```
