# ShareGPT Admin

独立的桌面管理端，用于连接 `../collab_server2` 协作服务并完成这些操作：

- 初始化管理员并登录管理后台；
- 创建、停用和编辑用户，管理聊天、高级 AI 与线路授权；
- 查看 ChatGPT、Claude 和 Gemini 已确认成功发送的次数与成员排行；
- 维护团队网络配置、内置代理线路及 ChatGPT/Gemini/Claude 推荐线路；
- 配置由服务端加密保存的托管翻译 API、用户授权和用量统计；
- 查看用户反馈和漏走代理域名；
- 维护版本信息与 `client_bootstrap.json` 备用扩展配置。

## 启动

当前源码对应 1.0.10 候选。常用入口依次为“AI 使用统计”“AI 线路策略”“翻译服务”和“成员与权限”；基础连接参数在“团队统一代理”中维护。

在仓库根目录可以直接运行：

```bash
npm run dev:admin
```

或进入管理端目录运行：

```bash
npm ci
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
管理端安装包版本与同一源码树的 ShareGPT 客户端版本保持一致。

## 服务端要求

管理端与协作服务端应来自同一个已验证的 tag 或提交。服务端默认只监听 `127.0.0.1`，生产环境应通过 HTTPS 反向代理访问；完整步骤见 [`../docs/SELF_HOSTING.md`](../docs/SELF_HOSTING.md)。托管翻译还要求服务端设置 `SHAREGPT_TRANSLATION_MASTER_KEY`。

### 线路配置顺序

1. 在“AI 线路策略”导入或维护线路并启用。
2. 在“成员与权限”勾选成员可使用的线路；高级环境权限与线路授权分开设置。
3. 回到“AI 线路策略”为 ChatGPT、Claude、Gemini 分别选择默认出口并保存。
4. 成员同步配置并恢复连接后，重新开启代理。已有高级环境不会被默认出口设置整体改绑。

1.0.10 普通成员可查看只读连接字段及选择获授权的基础代理方式。1.0.9 普通成员的旧主页开关可能不可操作，但仍支持管理员下发的各 AI 默认线路。只授权某条线路不会自动把它设成默认；应在设置默认前确认成员确实获准使用该线路。

### 1.0.10 服务端升级

新版本增加多种 AI 统计，并加强账号管理和个人资料同步保护；需要相应后端支持。部署前备份数据及密钥，按自托管指南逐实例验证和更新，保留旧客户端兼容。管理端中的版本信息维护不等于创建 GitHub Release；桌面更新仍以 GitHub Latest Release 为准。

首次部署时有两种方式创建管理员：

1. 直接在管理端登录页点击“首次初始化管理员”
2. 或在服务器上执行：

```bash
node add_user.js <username> <password> [avatar] --admin
```
