# TODO — 从「能跑的个人项目」到「高质量开源项目」

> 来源：2026-06 的一次毒舌评审。**原则：只动工程治理，不改功能；每改一处必须验证功能未受影响。修好前版本一律保持 `1.0.0`。**
> 进度标记：`[ ]` 未做 · `[~]` 进行中 · `[x]` 完成

## P0 — 不做就别自称高质量开源
- [x] **许可证定位**：已改为 **AGPL-3.0**（用户拍板）。`LICENSE`=AGPL-3.0 全文、`package.json` `license`=`AGPL-3.0-or-later`、README badge/措辞/许可证章节同步；ToS 风险仍靠免责声明承担。
- [x] **SECURITY.md**：已加（含代理相关风险范围 + 私密披露渠道占位）。
- [ ] **最小 CI**：`.github/workflows/ci.yml` —— 渲染层 + admin `tsc -b`、主进程 `node --check` / lint、一次构建冒烟；PR 必过。
- [ ] **第一批测试**：先覆盖 `collab_server2/server.js` 的 `hashPassword`/`verifyPassword`、session 过期、聊天读写、配置下发。加 `test` 脚本与测试运行器。

## P1 — 让它经得起协作
- [x] **社区文件**：已加 CONTRIBUTING.md、CODE_OF_CONDUCT.md、CHANGELOG.md（Keep a Changelog）、`.github/ISSUE_TEMPLATE/*`、PULL_REQUEST_TEMPLATE.md。
- [ ] **统一 lint/format**：根目录 ESLint + Prettier + `.editorconfig`，覆盖主进程与服务端，纳入 CI。
- [ ] **主进程类型化**：`src/main/*.js` 上 `// @ts-check` + JSDoc（低风险，先做），再谨慎拆分巨石 `appFactory.js`/`backend.js`（高风险，逐步且实测）。
- [ ] **服务端加固**（`collab_server2/server.js`，逐项实测）：
  - [ ] `process.on('uncaughtException')` / `unhandledRejection` 兜底，避免单异常拖垮全服务。
  - [ ] 原子写持久化（写 temp + rename），避免写一半损坏 `users.json`/`chat_history.json`；可加备份。
  - [ ] 登录接口限流 / 失败锁定，防暴力撞库。
  - [ ] 收紧 CORS（按需白名单，替代一律 `*`）。
- [ ] **第三方二进制供应链**：`scripts/prepare-assets.mjs` pin 版本 + SHA256 校验 sing-box / frpc。

## P2 — 锦上添花
- [ ] 崩溃上报 / 结构化日志（替代散落的 `console.warn`）。
- [ ] i18n（UI 与服务端日志去中文硬编码）。
- [ ] 架构图（client / collab_server2 / admin_console 交互 + IPC/WS 协议）。
- [ ] 仓库卫生：清理根目录内部草稿（`ANDROID_CHAT_ONLY_SPEC.md`、`REFACTOR_GOALS.md`、`CROSSPLATFORM.md` 等）与历史命名目录。
- [ ] **【最后做】macOS 代码签名 + 公证**（需 Apple Developer ID）→ 解锁 mac 原地无感更新。

## 验证基线（每次改完跑）
- 渲染层/admin：`npx tsc -b` 通过。
- 主进程：`node --check src/main/*.js` 通过。
- 服务端：本机起 `collab_server2/server.js`，关键接口（登录 / bootstrap / 聊天）冒烟通过。
- 构建冒烟：`npm run dist:win:sender` 能出 NSIS 包 + `latest.yml`。
