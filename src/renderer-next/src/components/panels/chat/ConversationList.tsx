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
  activeKey,
  filter,
  onFilterChange,
  onSelect,
  onStartPrivate,
}: {
  items: ConversationItem[]
  contacts: DirectoryUser[]
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
            placeholder="搜索会话…"
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
                    selected
                      ? 'bg-sidebar-accent'
                      : 'hover:bg-sidebar-accent/60',
                  )}
                >
                  <Avatar size="lg">
                    <AvatarFallback
                      className={cn(
                        it.kind === 'room' &&
                          'bg-primary/15 text-primary',
                      )}
                    >
                      {avatarMark(it.avatar, it.title)}
                    </AvatarFallback>
                    {it.kind === 'private' && it.online && (
                      <AvatarBadge className="bg-success" />
                    )}
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

        {contacts.length > 0 && (
          <div className="px-2 pb-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
              <Users className="size-3.5" />
              在线联系人
            </div>
            <ul className="flex flex-col gap-0.5">
              {contacts.map((user) => (
                <li key={user.username}>
                  <button
                    type="button"
                    onClick={() => onStartPrivate(user.username)}
                    className="flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60"
                  >
                    <Avatar size="default">
                      <AvatarFallback>
                        {avatarMark(user.avatar, user.displayName)}
                      </AvatarFallback>
                      {user.online && <AvatarBadge className="bg-success" />}
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {user.displayName || user.username}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
