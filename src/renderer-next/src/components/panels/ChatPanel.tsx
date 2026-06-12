// [团队重建目标] Telegram 式协作聊天:
// - 左: 会话/联系人列表(搜索、最近、在线、置顶、未读) ~300px
// - 右: 消息区(气泡、头像、时间、已读、回复引用) + 输入区(文本/附件: 剪贴板粘贴+文件)
// 数据: window.api.loadChatHistory/saveChatHistory + 协作实时(onAppEvent), 在线用户。
// 用 shadcn (ScrollArea/Avatar/Input/Button/Separator)。本面板为整块自定义布局, 不必用 PanelScaffold。
export function ChatPanel() {
  return (
    <section className="flex min-w-0 flex-1">
      <div className="flex w-[300px] shrink-0 flex-col border-r border-border">
        <div className="flex h-14 items-center border-b border-border px-4 text-sm font-semibold">
          协作聊天
        </div>
        <div className="grid flex-1 place-items-center p-4 text-center text-sm text-muted-foreground">
          会话列表 · 团队重建中
        </div>
      </div>
      <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
        消息区 · 团队重建中
      </div>
    </section>
  )
}
