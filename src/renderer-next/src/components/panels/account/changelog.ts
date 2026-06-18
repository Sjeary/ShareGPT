// 随包内置的更新日志 (4.2.0 → 现在)。展示在「账户」面板顶部的更新日志区。
// 新版本发布时在数组顶部追加一条即可 (newest first)。

export interface ChangelogEntry {
  version: string
  date: string // YYYY-MM-DD
  highlights: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '5.1.1',
    date: '2026-06-19',
    highlights: [
      '修复 Gemini / Claude 的提问未计入使用统计（发送后输入框瞬间清空导致漏记，改为同步读取问题文本）',
    ],
  },
  {
    version: '5.1.0',
    date: '2026-06-19',
    highlights: [
      '协作成员列表修正：展示全部成员、在线人数统计修正、已聊过的人加「已聊」标记',
      '打开会话时自动定位到最新消息（不再停在最旧）',
      '使用统计新增 Gemini、Claude 维度，可切换查看',
      '界面文字默认不可复制（网页、输入框、聊天消息等可变内容除外）',
      '登录页新增「发现新版本」提醒，可选择不再提示',
      '更新日志页与账户面板重新设计',
      '被管理员禁用协作聊天的成员，对其他人也不再显示',
      '修复客户端版本统计上报为空（管理端可正确看到每个人的版本）',
    ],
  },
  {
    version: '5.0.0',
    date: '2026-06-18',
    highlights: [
      '集成可选的 Claude 与 Gemini，可在「界面设置」中开关入口',
      '攻克 Claude 的 Cloudflare 人机验证死循环，修正 UA 与界面语言',
      '内嵌页面访问的全部域名纳入 sing-box 代理',
      '代理检测异常时直接红色告警并自动巡检',
      '管理员可禁止指定成员使用协作聊天',
      '新增应用图标',
    ],
  },
  {
    version: '4.2.1',
    date: '2026-06-13',
    highlights: [
      '新增「显示 Gemini」开关，控制导航栏 Gemini 入口',
      '管理端（Admin 控制台）重构，新增开发者全局发布',
      '若干稳定性与兼容性修复（含较新版 sing-box 适配）',
    ],
  },
  {
    version: '4.2.0',
    date: '2026-06-11',
    highlights: [
      '全新界面（新版 UI）',
      '内嵌 ChatGPT / Gemini，多标签同构',
      '协作聊天、发送/接收代理与使用统计',
    ],
  },
]
