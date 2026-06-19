# 更新日志

本项目的所有重要变更都会记录在本文件中。

格式基于 [Keep a Changelog 1.1.0](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [1.0.0] - 2026-06-19

首个正式版本。

### 新增

- 整合 **ChatGPT / Claude / Gemini** 三家 AI 网页于一个客户端（多标签、各自独立会话、登录态持久化，入口可在设置中开关）。
- **统一代理**：基于 sing-box，按内置域名清单仅对 AI 站点走代理；管理员统一下发连接配置，成员首登自动拉取，无需手配。
- **代理检测**：实时显示页面流量是否全部走代理；发现「会用到却没走代理」的域名时自动加入本机清单并上报管理员，重启即时生效。
- **可选机场订阅模式**：管理员粘贴 Clash 订阅、选节点下发，客户端可选择走机场节点（与统一代理并存，默认统一）。
- **团队协作聊天**：私聊 / 房间消息、图片与文件、撤回 / 已读 / 回复 / 转发、离线补同步、可自定义提醒。
- **使用统计**：按 ChatGPT / Gemini / Claude 维度统计每人查询量与排行。
- **管理控制台**：用户管理、Sender 默认配置下发、机场节点下发、用户反馈查看、漏走代理域名汇总、版本发布。

### 变更

- **自动更新改为以 GitHub Releases 为更新源**（参考 [cc-switch](https://github.com/farion1231/cc-switch)），不再经过任何自建服务器。
- **Windows 原地无感更新**：后台下载、自动安装并重启，快捷方式与安装位置不变，账号 / 聊天记录 / 网页登录态全部保留；macOS 暂为下载安装包方式。

### 备注

- 更早的 5.x 为测试版本，不在此正式记录。

[Unreleased]: https://github.com/Sjeary/ShareGPT/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Sjeary/ShareGPT/releases/tag/v1.0.0
