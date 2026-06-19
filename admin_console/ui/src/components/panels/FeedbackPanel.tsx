import { useEffect } from 'react'
import { MessageSquareText, RotateCw, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAdminStore } from '@/store/useAdminStore'
import { PanelScaffold } from './PanelScaffold'

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function FeedbackPanel() {
  const feedback = useAdminStore((s) => s.feedback)
  const loading = useAdminStore((s) => s.feedbackLoading)
  const loadFeedback = useAdminStore((s) => s.loadFeedback)

  useEffect(() => {
    void loadFeedback({ silent: true })
  }, [loadFeedback])

  return (
    <PanelScaffold
      icon={MessageSquareText}
      title="反馈建议"
      hint="用户从客户端提交的反馈，最新在前"
      toolbar={
        <Button variant="outline" size="sm" onClick={() => void loadFeedback()} disabled={loading}>
          <RotateCw className={loading ? 'animate-spin' : ''} />
          {loading ? '刷新中…' : '刷新'}
        </Button>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 p-6">
        {feedback.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-20 text-center text-sm text-muted-foreground">
            <Inbox className="size-8 opacity-40" />
            {loading ? '加载中…' : '还没有任何反馈'}
          </div>
        ) : (
          feedback.map((item) => (
            <Card key={item.id}>
              <CardContent className="grid gap-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">
                    {item.displayName || item.username || '匿名'}
                  </span>
                  {item.username && item.username !== item.displayName && (
                    <span className="text-xs text-muted-foreground">@{item.username}</span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatTime(item.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                  {item.text}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {item.version && <Badge variant="outline">v{item.version}</Badge>}
                  {item.platform && <Badge variant="outline">{item.platform}</Badge>}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </PanelScaffold>
  )
}
