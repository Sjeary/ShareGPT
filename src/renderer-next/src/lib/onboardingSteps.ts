import type { WorkspaceMode } from './workspaceCapabilities'

export interface OnboardingStep {
  // data-tour target; omitted for the centered welcome and completion cards.
  target?: string
  title: string
  body: string
}

export function buildOnboardingSteps(
  brand: string,
  workspaceMode: WorkspaceMode = 'organization',
): OnboardingStep[] {
  const isPersonal = workspaceMode === 'personal'
  const steps: OnboardingStep[] = [
    {
      title: `欢迎使用 ${brand} 👋`,
      body: '花 30 秒带你认识主界面的几个核心功能，随时可以跳过。',
    },
    {
      target: 'nav-service',
      title: '网络与代理',
      body: isPersonal
        ? '在这里填写或一键探测你的本机代理。开启后，内嵌的 AI 网页会自动复用该代理。'
        : '在这里查看或开启团队代理出口。开启后，内嵌的 AI 网页会自动复用同一个代理。',
    },
  ]
  if (!isPersonal) {
    steps.push({
      target: 'nav-chat',
      title: '协作聊天',
      body: '和团队成员实时收发消息、互传文件，在线状态一目了然。输入框可插入表情；消息可加表情回应，纯表情消息会放大并动态显示。',
    })
  }
  steps.push({
    target: 'nav-gpt',
    title: '内嵌 AI 网页',
    body: 'ChatGPT / Gemini / Claude 直接在客户端里打开，免去来回切换浏览器。空白处右键有浏览器式菜单；Ctrl + 鼠标滚轮（或 Ctrl 加 +/-/0）可缩放页面。',
  })
  if (!isPersonal) {
    steps.push({
      target: 'nav-stats',
      title: '使用统计',
      body: '查看用量与排行，了解团队的整体使用情况。',
    })
  }
  steps.push(
    {
      target: 'nav-account',
      title: '更多功能可以在这里发掘',
      body: isPersonal
        ? '个人日历、备忘录 / 待办、笔记 / 知识库和专注默认收起。需要时进入「账户 → 界面设置」按需显示；应用更新与隐私配置也在这里管理。本引导只告诉你位置，不会替你开启。'
        : '个人日历、组队日历、备忘录 / 待办、笔记 / 知识库和专注默认收起。需要时进入「账户 → 界面设置」按需显示；协作通知也在这里管理。本引导只告诉你位置，不会替你开启。',
    },
    {
      title: '准备就绪 🎉',
      body: '就这些！现在开始上手吧。左侧入口可长按拖动排序，按 Ctrl/Cmd + K 可随时快速跳转；需要时点标题栏右上角的「?」可再次查看本引导。',
    },
  )
  return steps
}
