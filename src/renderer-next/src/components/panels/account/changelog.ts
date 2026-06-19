// 随包内置的更新日志 (随包离线展示)。展示在「账户」面板顶部的更新日志区。
// 规范: 每个版本只写 2-4 条「面向用户」的要点; 详细变更以 GitHub Release notes 为准。
// 新版本发布时在数组顶部追加一条即可 (newest first)。

export interface ChangelogEntry {
  version: string
  date: string // YYYY-MM-DD
  highlights: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date: '2026-06-19',
    highlights: [
      '首个正式版本：把 ChatGPT / Claude、团队协作聊天与统一代理整合进一个桌面客户端。',
      'Windows 原地无感更新：检查到新版后台下载、自动安装并重启，快捷方式与本机数据（账号 / 聊天记录 / 网页登录态）全部保留。',
      '自动更新源为 GitHub Releases，不经任何自建服务器；更早的 5.x 均为测试版本。',
    ],
  },
]
