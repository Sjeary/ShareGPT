# ChatPortal X1 V4 项目交接文档

## 项目描述

ChatPortal X1 V4 是一个基于 Electron 的桌面客户端，面向需要同时处理网络连接、实时聊天和内嵌 AI 网页使用场景的用户。

项目当前由两个主要运行形态组成：

- `Sender`：负责在本机启动 `sing-box`，通过远端代理把指定网站流量导向目标出口，同时提供账号登录、联系人聊天、房间消息、AI 网页入口和 AI 使用统计。
- `Receiver`：负责在另一台设备上接收来自 Sender 的连接，并使用 `sing-box + frpc` 完成接收和转发。

产品目标不是通用浏览器，而是一个带有通信协作能力的网络工作台。

当前 `v4_electron` 是独立代码库，保留了与 `v3_electron` 并行存在的隔离能力。V4 使用独立的应用标识、构建产物名和用户数据目录，不与 V3 共用本地运行状态。

当前版本以 V3 的稳定功能为基线，已经完成 Sender、Receiver、协作服务和内嵌 AI 工作区的整体迁移，可作为后续 V4 开发的独立起点。

## 当前已经完成的功能

### Sender 侧

- 连接设置页面
- 固定站点走代理
- 本地代理端口设置
- 发送服务启动、停止、保存
- 运行状态展示
- 未登录时仅显示登录页
- 协作账号登录、退出、记住密码、回车登录
- 账号资料页、头像、昵称、资料同步
- 联系人列表、私聊、房间消息
- 图片与文件消息
- 消息回复 / 引用
- 未读计数与消息提醒
- 系统通知与提示铃声开关
- 本地聊天记录保存
- 离线后重新上线自动补同步历史消息
- 撤回自己发送的消息
- 最近会话列表、会话搜索、最近消息预览
- 多行输入、日期分隔、消息分组与更贴近 Telegram 的聊天排版
- 消息右键复制文本
- 本机资料包导入导出
- 消息设置页
- 内嵌 `ChatGPT` 网页工作区
- `ChatGPT` 多标签页工作区
- `GPT` 使用统计页面
- 新增内嵌 `Gemini` 网页工作区
- 首次启动配置引导弹窗
- 首次登录后从服务端自动拉取 Sender 连接配置
- 应用内检查、下载并打开新版本安装包
- 固定 `ShareGPT` 用户数据目录，更新后保留配置、聊天记录和 AI 网页登录状态

### Receiver 侧

- 接收端设置页面
- `sing-box` 和 `frpc` 启停
- 接收端运行日志
- 与 Sender 风格一致的 UI

### 协作服务端

- 账号密码登录
- WebSocket 在线状态同步
- 联系人列表
- 房间消息和私聊
- 账号资料同步
- 聊天历史落盘保存
- 历史消息按唯一 ID 合并更新，支持离线补同步与撤回状态同步
- GPT 使用次数上报与按时间范围统计
- 首次登录客户端配置下发
- Windows / macOS 发行包下载地址下发
- 管理员接口：用户管理、配置管理、版本发布

### 管理端

- 独立 Electron 桌面程序，位于 `admin_console/`
- 支持 Windows / macOS 打开
- 管理员登录和首次管理员初始化
- 查看、创建、编辑用户
- 维护 Sender 默认连接配置
- 上传 Windows / macOS 发行包
- 维护服务端备用扩展配置

## 当前页面结构

### Sender

- `连接设置`
- `运行记录`
- `账号与信息`
- `ChatGPT 网页`
- `Gemini 网页`
- `联系人与聊天`
- `消息设置`
- `AI 使用统计`

### Receiver

- `接收端设置`
- `运行记录`

## 内嵌 AI 网页现状

### ChatGPT

- 使用 Electron `WebContentsView`
- 通过 Sender 本地 SOCKS 代理访问
- 页面会话可持久化
- 支持后退、前进、刷新、浏览器打开、全屏
- 会话切换后尽量回到原先页面位置
- 由主进程控制导航、权限、弹窗和外链跳转

### Gemini

- 使用独立 `WebContentsView`
- 使用独立持久分区 `persist:gemini-chat`
- 复用 Sender 本地 SOCKS 代理访问
- 支持后退、前进、刷新、浏览器打开、全屏
- 已补充 Google / Gemini 相关允许域名，目标是让 Google 账号登录在内嵌页中可进行
- 由主进程控制导航、权限、弹窗和外链跳转

## 当前代码结构

### 客户端主进程

- `src/main/appFactory.js`
  - Electron 窗口创建
  - `WebContentsView` 工作区创建与挂载
  - IPC 注册
  - 外部浏览器打开
  - 内嵌网页代理会话配置

- `src/main/backend.js`
  - 设置读取与保存
  - 本地聊天记录读取与保存
  - 本机资料包导入与导出
  - 私有默认配置读取
  - `sing-box` / `frpc` 路径解析
  - Sender / Receiver 配置生成
  - Sender / Receiver 进程管理
  - 应用版本信息和更新包下载

- `src/main/preload.js`
  - 渲染层 API 暴露

### 客户端渲染层

- `src/renderer/index.html`
  - 主界面结构

- `src/renderer/renderer.js`
  - 页面切换
  - 表单状态
  - 聊天逻辑
  - 附件发送、回复引用、最近会话、系统通知、提示铃声
  - GPT 与 Gemini 工作区逻辑
  - 提示、未读、统计等前端行为

- `src/renderer/styles.css`
  - 主界面统一样式

- `src/renderer/profile.*`
  - 个人资料独立窗口

### 服务端

- `collab_server2/server.js`
  - 登录、资料接口、WebSocket、聊天、GPT 统计
  - 客户端默认配置下发
  - 管理员 API
  - 发行包下载

- `collab_server2/add_user.js`
  - 创建服务端用户或管理员用户

### 管理端

- `admin_console/src/main/main.js`
  - 管理端窗口、偏好保存、安装包上传

- `admin_console/src/main/preload.js`
  - 管理端渲染层 API 暴露

- `admin_console/src/renderer/*`
  - 管理端登录、用户、配置和版本发布 UI

## 配置与数据流

### 默认配置

- 公开默认值来自 `src/main/backend.js` 中的 `PUBLIC_DEFAULT_SETTINGS`
- 本地私有默认值来自 `private.defaults.local.json`

### 运行时配置优先级

1. `private.defaults.local.json`
2. 用户目录 `settings.json`
3. 登录后从服务端拉取的 Sender 默认配置
4. 运行中页面保存后的设置

首次启动时，如果没有检测到 `private.defaults.local.json`，程序会在用户目录自动生成一个本地模板文件。

### 更新与状态保留

客户端用户数据目录固定为 `ShareGPT`：

- Windows：`%APPDATA%\ShareGPT`
- macOS：`~/Library/Application Support/ShareGPT`

保存内容包括：

- `settings.json`
- `chat_history.json`
- ChatGPT 持久会话 `persist:gpt-chat`
- Gemini 持久会话 `persist:gemini-chat`
- 下载的更新包缓存

新版本启动时会兼容迁移旧应用名目录中尚未复制的数据，不覆盖当前目录已有数据。当前更新机制是“检查、下载并打开安装包”的辅助更新，不是静默自动替换。

更新容错策略：

- 打开安装包前会刷新 ChatGPT / Gemini 持久会话数据
- 打开安装包前会复制关键资料到独立目录 `ShareGPT Backups`
- 快照目录默认保留最近 5 份
- 如果快照失败，客户端不会继续打开安装包
- 安装包打开成功后，当前程序会自动退出，避免旧程序占用文件导致覆盖安装失败
- 更新包保存到系统“下载”目录下的 `ShareGPT Updates/<version>/`，文件名带下载时间戳，便于用户直接找到并区分新旧版本
- 如果更新后用户数据目录缺失，启动时会从最近一次快照恢复缺失的设置、聊天记录和 AI 网页会话目录

### 二进制资源查找

项目不应再依赖仓库外层的固定目录名。

当前约定的资源来源为：

1. 环境变量 `CHATPORTAL_SINGBOX_PATH` / `CHATPORTAL_FRPC_PATH`
2. 环境变量 `CHATPORTAL_BIN_DIR`
3. 仓库内 `build/bin/<platform>/`
4. 仓库内 `build/bin/`
5. 打包后的 `resources/bin/` 或程序目录 `bin/`

### 运行时生成文件

客户端会在用户目录下生成：

- `settings.json`
- `chat_history.json`
- `runtime/sender.runtime.json`
- `runtime/receiver.singbox.runtime.json`
- `runtime/receiver.frpc.runtime.ini`
- `updates/`
- 外部更新快照目录 `ShareGPT Backups`

服务端会在 `collab_server2/data/` 下生成：

- `users.json`
- `chat_history.json`
- `gpt_usage.json`
- `client_bootstrap.json`
- `releases/`

## 打包与分发状态

- Windows：
  - 支持 `Sender`
  - 支持 `Receiver`
  - 支持合并便携包

- macOS：
  - 当前只支持 `Sender`
  - 使用仓库内的 macOS `sing-box`
- 主窗口保留原生交通灯按钮，隐藏自定义右上角按钮
  - Sender 打包不要求 `frpc`

- Linux：
  - 保留基础打包脚本，但不是当前主要验证目标

## 当前工作区状态

截至当前工作区，GPT / Gemini 工作区已经迁移到主进程 `WebContentsView`，相关文件包括：

- `src/renderer/index.html`
- `src/renderer/renderer.js`
- `src/renderer/styles.css`
- `src/main/backend.js`
- `src/main/appFactory.js`
- `collab_server2/server.js`

当前已完成：

- `ChatGPT` / `Gemini` 页面入口
- 主进程 `WebContentsView` 管理与 IPC 控制
- 独立持久会话
- 与 `ChatGPT` 同代理
- Google / Gemini 相关域名纳入默认代理目标
- 设置持久化接入
- Sender 本地聊天记录持久化
- 离线后重新上线自动补同步历史消息
- 撤回自己发送的消息
- 本机资料包导入导出
- 图片与文件消息
- 系统通知与提示铃声
- Receiver 模式隐藏 Gemini 页面

当前仍需人工确认：

- Google 账号登录是否能在内嵌页内稳定完成
- 是否会触发额外验证、人机校验或跳外部浏览器
- 页面跳转限制是否还需补充更多 Google 域名

说明：

- 当前代码已通过 `node --check`
- 当前没有完成 GUI 手动验收

## 交给下一个模型时建议重点检查的方向

### 1. Gemini 登录与页面兼容性

- 检查 Google 登录流程是否能完整留在内嵌页面中
- 检查 `WebContentsView` 下的跳转拦截、会话持久化是否足够
- 检查是否需要补充更多允许内嵌的 Google 域名

### 2. GPT / Gemini 工作区代码去重

- 当前 `ChatGPT` 和 `Gemini` 工作区逻辑高度相似
- 可以考虑抽成通用的 `AI workspace` 管理层，减少重复代码

### 3. 文档与发行说明同步

- 后续新增功能时，继续同步 `README.md`、发行说明和页面列表
- 保持 V4 与发行包名称、版本号和交接文档一致

### 4. 手动联调

- 启动 Sender 后分别验证：
  - ChatGPT
  - Gemini
  - 默认浏览器打开
  - 全屏
  - 切换页面后恢复原位置

### 5. 代码质量提升方向

- 将 AI 网页工作区状态管理进一步模块化
- 统一 `gpt` / `gemini` 的会话配置、导航按钮、运行状态更新逻辑
- 为关键流程补最少的冒烟测试或手动测试清单

## 功能更新记录

后续新增功能时，建议继续在本节追加记录，格式保持统一。

### 当前已记录的阶段性功能

- 主界面重构为 Sender / Receiver 统一工作台风格
- Sender 未登录时仅显示登录卡片
- 协作账号登录、记住密码、回车登录
- 联系人列表、私聊、房间消息、未读消息计数
- 消息提醒设置
- 图片与文件消息
- 本地聊天记录保存与资料包迁移
- 个人资料独立窗口
- 内嵌 ChatGPT 网页工作区
- GPT 使用统计
- Receiver UI 同步为 Sender 风格
- 新增 Gemini 内嵌网页工作区
- 二进制查找逻辑改为仓库内路径和环境变量优先
- 首次启动自动生成本地私有配置模板
- 首次启动配置引导弹窗
- V4 内嵌 AI 页面迁移到 `WebContentsView`
- ChatGPT 工作区升级为多标签页架构，可新建、切换和关闭多个会话
- 聊天左侧列表升级为“最近会话 / 联系人”双栏切换
- 私聊消息新增真实已读/未读状态，基于服务端回执同步
- 聊天图片预览支持滚轮缩放与拖拽查看
- 首次登录后自动从服务端拉取 Sender 默认配置
- 服务端新增管理员 API
- 新增独立管理端 `admin_console/`
- 管理端支持用户管理、Sender 默认配置维护、发行包上传
- 客户端支持应用内检查、下载并打开新版本安装包
- 客户端用户数据固定到 `ShareGPT` 目录，并兼容迁移旧目录数据

## 文档维护约定

后续如果继续开发，建议每次新增功能后至少同步更新下面两处：

- 本文件中的 `当前已经完成的功能`
- 本文件中的 `功能更新记录`

如果改动影响用户可见功能，还应同步更新：

- `README.md`


