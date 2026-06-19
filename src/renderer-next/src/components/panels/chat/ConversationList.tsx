import { Search, Users } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarBadge, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { DirectoryUser } from '@/store/useChatStore'
import { avatarMark, formatConversationTime } from './format'
import type { ConversationItem } from './conversations'

// 左侧会话列表: 顶部搜索 + 会话列表 + 在线联系人分区 (点击开私聊)。
export function ConversationList({
  items,
  contacts,
  chattedUsernames,
  memberOnline,
  memberTotal,
  activeKey,
  filter,
  onFilterChange,
  onSelect,
  onStartPrivate,
}: {
  items: ConversationItem[]
  contacts: DirectoryUser[]
  // 已与之有过私聊的成员用户名集合, 用于在名册中标注「已聊」。
  chattedUsernames: Set<string>
  // 头部「X / Y 在线」: 取全体成员 (不受搜索过滤影响) 的在线数与总数。
  memberOnline: number
  memberTotal: number
  activeKey: string
  filter: string
  onFilterChange: (v: string) => void
  onSelect: (key: string) => void
  onStartPrivate: (username: string) => void
}) {
  return (
    <div className="flex w-[300px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex h-14 shrink-0 items-center border-b border-border px-3">
        <div className="relative w-full">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder="搜索会话或成员…"
            className="h-9 bg-background pl-8"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col gap-0.5 p-2">
          {items.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">
              {filter ? '没有匹配到会话' : '最近会话会显示在这里'}
            </li>
          )}
          {items.map((it) => {
            const selected = it.key === activeKey
            return (
              <li key={it.key || 'room'}>
                <button
                  type="button"
                  onClick={() => onSelect(it.key)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                    selected ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60',
                  )}
                >
                  <Avatar size="lg">
                    <AvatarFallback
                      className={cn(it.kind === 'room' && 'bg-primary/15 text-primary')}
                    >
                      {avatarMark(it.avatar, it.title)}
                    </AvatarFallback>
                    {it.kind === 'private' && it.online && <AvatarBadge className="bg-success" />}
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {it.title}
                      </span>
                      {it.timestamp && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {formatConversationTime(it.timestamp)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {it.lastReadState.kind === 'sent' && (
                          <span className="mr-1 text-muted-foreground/70">✓</span>
                        )}
                        {it.lastReadState.kind === 'read' && (
                          <span className="mr-1 text-primary">✓✓</span>
                        )}
                        {it.lastReadState.kind === 'count' && (
                          <span className="mr-1 text-primary">{it.lastReadState.count} 已读</span>
                        )}
                        {it.preview}
                      </span>
                      {it.unread > 0 && (
                        <Badge className="h-5 min-w-5 justify-center rounded-full px-1.5 text-[11px]">
                          {it.unread > 99 ? '99+' : it.unread}
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>

        {memberTotal > 0 && (
          <div className="mt-1 border-t border-border px-2 pb-2 pt-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
              <Users className="size-3.5" />
              <span>群组成员</span>
              <span className="ml-auto tabular-nums text-[11px] text-muted-foreground/70">
                {memberOnline} / {memberTotal} 在线
              </span>
            </div>
            {contacts.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                {filter.trim() ? '没有匹配到群组成员' : '暂无其他成员'}
              </div>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {contacts.map((user) => {
                  const chatted = chattedUsernames.has(user.username)
                  return (
                    <li key={user.username}>
                      <button
                        type="button"
                        onClick={() => onStartPrivate(user.username)}
                        className="flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60"
                      >
                        <Avatar size="default" className={cn(!user.online && 'opacity-60')}>
                          <AvatarFallback>
                            {avatarMark(user.avatar, user.displayName)}
                          </AvatarFallback>
                          {user.online && <AvatarBadge className="bg-success" />}
                        </Avatar>
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate text-sm',
                            !user.online && 'text-muted-foreground',
                          )}
                        >
                          {user.displayName || user.username}
                        </span>
                        {chatted && (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground/80">
                            已聊
                          </span>
                        )}
                        <span
                          className={cn(
                            'shrink-0 text-[11px]',
                            user.online ? 'text-success' : 'text-muted-foreground/70',
                          )}
                        >
                          {user.online ? '在线' : '离线'}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
