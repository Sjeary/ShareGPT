# ShareGPT 客户端界面

这里是当前桌面客户端的 React、TypeScript 和 Vite 界面。主窗口由 `index.html` 进入 `src/main.tsx`，个人资料窗口由 `profile.html` 进入 `src/profile.tsx`；两者共用主题和组件。历史 HTML 界面位于仓库的 `legacy/renderer/`。

## 目录职责

| 位置                             | 内容                                |
| -------------------------------- | ----------------------------------- |
| `src/App.tsx`                    | 初始化、工作区选择与登录入口        |
| `src/components/layout/`         | 窗口标题栏、侧栏和应用布局          |
| `src/components/panels/`         | 功能页面及各页面相邻组件            |
| `src/components/ui/`             | 共享 shadcn/Radix 基础组件          |
| `src/components/ErrorNotice.tsx` | 各功能共用的错误提示                |
| `src/hooks/`                     | 登录、同步、聊天、AI 宿主等界面行为 |
| `src/store/`                     | 应用与各功能的 Zustand 状态         |
| `src/lib/`                       | 通信、业务辅助及可独立检查的逻辑    |
| `src/types/`                     | 主进程通信与设置类型                |
| `src/index.css`                  | 主题变量、基础样式与共享样式        |
| `src/**/*.test.ts`               | 与被检查逻辑相邻的前端测试          |

界面经 `window.api` 调用 Electron preload 暴露的能力。本机能力及其调用者校验由 `src/main/` 维护；协作服务接口由 `collab_server2/` 提供。界面组件、共享状态、通信类型和实际执行方分别位于上述目录。

## 开发命令

从仓库根目录执行：

```bash
# 安装本界面的锁定依赖
npm --prefix src/renderer-next ci

# 只启动 Vite 开发服务
npm --prefix src/renderer-next run dev

# 构建界面后启动完整桌面客户端
npm run dev

# 前端测试、测试类型、规范和生产构建
npm --prefix src/renderer-next test
npm --prefix src/renderer-next run typecheck:test
npm --prefix src/renderer-next run lint
npm run build:next
```

Vite 服务使用端口 `5234`。独立浏览器预览没有完整的本机通信桥；涉及账号、AI 网页、资料保存或本机能力的验证使用仓库现有的对应 `verify:*` 入口。后台验收的窗口与资料隔离说明见[贡献指南](../../.github/CONTRIBUTING.md)。

生产构建生成 `dist/index.html`、`dist/profile.html` 和静态资源，主进程通过 `rendererEntry.js` 加载。`dist/` 与 `node_modules/` 不提交；完整客户端不依赖 Vite 服务运行。

整体组件关系、数据链路及其他服务见[架构总览](../../docs/ARCHITECTURE.md)。
