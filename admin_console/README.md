# ShareGPT Admin

独立的桌面管理端，用于连接 `v4_electron/collab_server2` 服务并完成这些操作：

- 管理员登录
- 查看用户、编辑用户、创建用户
- 维护首次登录自动下发的 Sender 默认配置
- 上传 Windows / macOS 安装包并发布更新信息
- 保存服务端 `client_bootstrap.json` 的备用扩展配置

## 启动

在 `v4_electron/` 根目录可以直接运行：

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

在 `v4_electron/` 根目录也可以运行：

```bash
npm run dist:admin:win
npm run dist:admin:mac
```

Windows 会生成便携版，macOS 会生成 DMG。管理端不依赖 `sing-box`、`frpc` 或客户端运行资源。

## 服务端要求

请先把 `v4_electron/collab_server2/server.js` 更新到带有 `/api/admin/*` 接口的新版本。

首次部署时有两种方式创建管理员：

1. 直接在管理端登录页点击“首次初始化管理员”
2. 或在服务器上执行：

```bash
node add_user.js <username> <password> [avatar] --admin
```
