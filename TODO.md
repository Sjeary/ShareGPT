# TODO — 从「能跑的个人项目」到「高质量开源项目」

> 来源：2026-06 的一次毒舌评审。**原则：只动工程治理，不改功能；每改一处必须验证功能未受影响。修好前版本一律保持 `1.0.0`。**
> 进度标记：`[ ]` 未做 · `[~]` 进行中 · `[x]` 完成

## P0 — 不做就别自称高质量开源
- [x] **许可证定位**：已改为 **AGPL-3.0**（用户拍板）。`LICENSE`=AGPL-3.0 全文、`package.json` `license`=`AGPL-3.0-or-later`、README badge/措辞/许可证章节同步；ToS 风险仍靠免责声明承担。
- [x] **SECURITY.md**：已加（含代理相关风险范围 + 私密披露渠道占位）。
- [x] **最小 CI**：`.github/workflows/ci.yml` —— push/PR 触发，跑主进程+服务端 `node --check`、渲染层 + admin `tsc -b`、`npm test`（均已本地验证通过）。lint 待统一后再纳入。
- [~] **第一批测试**：已加 `npm test`（Node 内置 runner，无新依赖）+ `collab_server2/test/server.test.js`（6 用例：hashPassword/verifyPassword/原子写/normalizeIp/登录限流/safeParseJson）。待补：session 过期、聊天读写、配置下发。

## P1 — 让它经得起协作
- [x] **社区文件**：已加 CONTRIBUTING.md、CODE_OF_CONDUCT.md、CHANGELOG.md（Keep a Changelog）、`.github/ISSUE_TEMPLATE/*`、PULL_REQUEST_TEMPLATE.md。
- [~] **统一 lint/format**：已加 `.editorconfig` + `.gitattributes`（LF）。根 ESLint + Prettier 配置 + 纳入 CI 待做（分步推进，避免一次性大规模 reformat 影响可读历史）。
- [ ] **主进程类型化**：`src/main/*.js` 上 `// @ts-check` + JSDoc（低风险，先做），再谨慎拆分巨石 `appFactory.js`/`backend.js`（高风险，逐步且实测）。
- [x] **服务端加固**（`collab_server2/server.js`，已逐项实测：启动/健康/登录成功+失败+限流/原子写）：
  - [x] `process.on('uncaughtException')` / `unhandledRejection` 兜底（记录日志、不拖垮全服务）。
  - [x] 原子写持久化 `writeJsonAtomic`（temp + rename），替换 users/chat/usage/bootstrap 四处热写。
  - [x] 登录限流：同 IP 失败 `LOGIN_MAX_FAILS`(默认10) 次锁定 `LOGIN_LOCK_MS`(默认15min)，普通+管理员登录均覆盖，可 env 调。
  - [x] CORS 改为 `CORS_ORIGIN` 可配（默认 `*`，附说明：Bearer-token 鉴权不依赖 cookie，通配风险有限）。
- [x] **第三方二进制供应链**：新增 `build/bin/checksums.json`（固定版本 + SHA256）；`prepare-assets.mjs` 拷贝时核对，不匹配告警、构建 `--required` 时失败；`build/bin/README.md` 写明更新流程。（已实测校验通过，发现 Win/mac sing-box 版本不一致 1.11.8/1.12.17，已如实记录）

## P2 — 锦上添花
- [~] 崩溃上报 / 结构化日志：已加 `src/main/logger.js`（分级 + 同步落盘 `userData/logs/main.log` + 轮转，零外部上传）+ 主进程 `uncaughtException`/`unhandledRejection` 兜底（原先完全没有）。已实测。待办：把散落的 `console.warn/error` 逐步迁到 logger（大范围替换，分步做）。
- [ ] i18n（UI 与服务端日志去中文硬编码）。
- [x] 架构图：新增 `docs/ARCHITECTURE.md`（mermaid 三端交互 + IPC/WS/代理/更新链路 + 协议表），README 已链接。
- [x] 仓库卫生：内部草稿（`ANDROID_CHAT_ONLY_SPEC.md`/`REFACTOR_GOALS.md`/`CROSSPLATFORM.md`）移到 `docs/dev/`；`release_sender*` 历史目录本就 gitignore。
- [ ] **【最后做】macOS 代码签名 + 公证**（需 Apple Developer ID）→ 解锁 mac 原地无感更新。

## 验证基线（每次改完跑）
- 渲染层/admin：`npx tsc -b` 通过。
- 主进程：`node --check src/main/*.js` 通过。
- 服务端：本机起 `collab_server2/server.js`，关键接口（登录 / bootstrap / 聊天）冒烟通过。
- 构建冒烟：`npm run dist:win:sender` 能出 NSIS 包 + `latest.yml`。
