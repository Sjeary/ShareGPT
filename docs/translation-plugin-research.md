# 内置翻译早期调研（历史归档）

> 本文最初用于比较 Electron 扩展、网页脚本和原生翻译工作流。1.0.9 已经采用受限的主进程桥接与独立翻译工作台，因此本文不再是实现计划、价格指南或现行 API 规范。

## 已采用的方向

ShareGPT 没有加载第三方浏览器翻译扩展，也没有向 renderer 暴露任意 JavaScript 执行能力。当前生产 owner 是：

- `src/renderer-next/src/components/panels/ai/TranslationPanel.tsx`：阅读翻译、写入 AI、配置、停止操作和用户反馈；
- `src/renderer-next/src/store/useTranslationStore.ts`：Principal 作用域内的翻译配置与操作状态；
- `src/main/translation.js`：兼容翻译 API 和本地离线端点的受控 HTTP 请求；
- `src/main/appFactory.js`：页面读取、composer target/write/confirmation 和请求取消 IPC；
- `collab_server2/server.js`：团队托管翻译、授权、取消、用量与服务端密钥使用；
- `admin_console/ui/src/components/panels/TranslationPanel.tsx`：管理员配置托管服务、用户授权和用量查看。

## 当前用户工作流

### 阅读翻译

- 可以手动输入，也可以读取当前网页选区或当前页面文本。
- 原文和译文保留在翻译面板，不会自动写入 ChatGPT、Gemini 或 Claude 的输入框。
- 面板在空间足够时与网页并排，宽度可在 320–720 px 之间调整；窄窗口改为独立替换视图，保证网页与翻译区都可用。

### 写入 AI

- 用户先编辑原文，再选择“仅译文”或“原文 + 译文”预览。
- 写入前重新获取与当前 kind、tab、environment、document、generation 绑定的 composer target。
- AI 网页存在旧草稿时不会静默覆盖；用户必须明确选择追加或替换。
- 写入只填充输入框，不代表发送。可选 Enter 确认默认关闭，使用时也必须经过当前网页确认。

### 翻译来源

- **团队配置**：组织用户选择管理员授权的 profile。API Key 只在服务端解密和使用，不进入 profile 列表或客户端设置；服务端按成功用量记录字符、token 或费用字段。
- **AI**：使用 Principal 作用域内配置的 OpenAI Responses 兼容接口，支持流式结果。
- **翻译 API**：调用返回常见 `translatedText` / `translation` / `translations[0].text` 结构的兼容 HTTP API。
- **本地离线**：只允许 loopback 主机，默认面向本机 LibreTranslate 兼容服务。

个人工作区不显示团队托管 profile，使用自己的本地配置；切换到组织 Principal 后恢复该组织账号自己的设置。两侧配置不会互相覆盖。

## 取消与生命周期

- 每次翻译都有独立 request ID 和取消句柄。用户点击“停止翻译”会中止本地请求；团队模式还会通知服务端取消对应上游工作。
- 切换阅读/写入模式、AI 标签、环境、Principal 或关闭面板时，旧 generation 失效。迟到的 delta、done 或 error 不能更新当前界面。
- 如果停止前已有一份完成的写入预览，停止新请求会恢复那份预览；未完成内容不会被当作可写入结果。

## 网络与安全边界

- 公网翻译和 AI 端点支持 HTTPS 与明确配置的 HTTP。HTTP 会在界面显示内容和密钥可能明文传输的警告。
- URL 只接受 HTTP(S)。DNS 解析后会固定已验证地址并保留 Host/SNI，拒绝混合公网/私网解析、metadata、loopback 和其它危险目标。
- 本地离线模式是单独的 loopback 例外，不能借此访问任意内网。
- composer 桥只支持预定义的读取、目标确认和写入操作；不得恢复 `executeAiJavaScript` 或任何通用脚本 IPC。

## 未采用的历史方案

### 直接加载浏览器扩展

Electron 对 Chrome Extension API 的支持范围与 Chrome 不同，第三方扩展还会引入自己的权限、更新和数据边界。ShareGPT 当前不依赖该路径。

### 通用 content script 注入

通用注入难以同时保证网页版本适配、文档身份、取消和最小权限。当前实现只允许主进程生成的固定 isolated-world 操作，并由 workspace/document/generation 合同约束。

## 维护验证

翻译改动至少覆盖：

- provider 配置与 Principal A/B/A 隔离；
- HTTP/HTTPS、DNS 固定、危险地址和本地离线例外；
- 阅读/写入分离、停止与迟到事件；
- 窄窗口替换模式、拖拽宽度和最大/最小边界；
- composer 旧草稿冲突、SPA 导航、document/generation 变化；
- 团队 profile 不泄露密钥、授权拒绝、成功用量和服务端幂等。

## 参考资料

- [Electron Chrome Extension Support](https://www.electronjs.org/docs/latest/api/extensions)
- [Manifest V3 support tracking · electron/electron#49984](https://github.com/electron/electron/issues/49984)
- [LibreTranslate](https://github.com/LibreTranslate/LibreTranslate)

第三方价格、免费额度、模型名称和 Electron 扩展兼容状态都可能变化，维护文档不固定快照；需要评估时应查阅供应商和 Electron 的当前官方资料。
