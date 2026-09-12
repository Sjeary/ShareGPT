import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import {
  settingsPrincipalRuntime,
  type SettingsPrincipalSnapshot,
} from '@/lib/settingsPrincipalRuntime'
import { withUserDataTransition } from '@/lib/userDataLifecycle'
import { useAppStore } from '@/store/useAppStore'
import type { LegacyDataCategory, LegacyDataSummary } from '@/types/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const labels: Record<LegacyDataCategory, string> = {
  calendar: '个人日历',
  tasks: '待办与备忘录',
  focus: '专注记录',
  chat: '聊天历史',
  notes: '笔记与附件',
}

export function LegacyDataImport() {
  const personal = useAppStore((s) => s.workspaceMode === 'personal')
  const authed = useAppStore((s) => s.authed)
  const username = useAppStore((s) => s.settings?.collab?.last_username || '')
  const server = useAppStore((s) => s.settings?.collab?.server_url || '')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<LegacyDataSummary[]>([])
  const [snapshot, setSnapshot] = useState<SettingsPrincipalSnapshot | null>(null)
  const [selected, setSelected] = useState<
    (LegacyDataSummary & { group?: string; label?: string }) | null
  >(null)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const target = personal ? '个人工作区（仅本机）' : `${username} · ${server}`

  async function inspect() {
    setBusy(true)
    setError('')
    try {
      const current = settingsPrincipalRuntime.snapshot()
      const summaries = await api.inspectLegacyUserData()
      settingsPrincipalRuntime.assertCurrent(current)
      setSnapshot(current)
      setItems(summaries)
      setSelected(null)
      setConfirmed(false)
      setOpen(true)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '无法读取旧资料')
    } finally {
      setBusy(false)
    }
  }

  async function importSelected() {
    if (!selected || !snapshot || !confirmed) return
    setBusy(true)
    setError('')
    try {
      await withUserDataTransition(
        async () => {
          settingsPrincipalRuntime.assertCurrent(snapshot)
          await api.importLegacyUserData({
            category: selected.category,
            fingerprint: selected.fingerprint,
            group: selected.group,
          })
        },
        { reload: true },
      )
      toast.success(
        `${labels[selected.category]}已接续到${personal ? '个人工作区' : '当前账号'}，旧原件已保留`,
      )
      await inspect()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '接续失败，原资料已保留')
    } finally {
      setBusy(false)
    }
  }

  function choose(item: LegacyDataSummary & { group?: string; label?: string }) {
    setSelected(item)
    setConfirmed(false)
    setError('')
  }

  return (
    <>
      <Button
        variant="outline"
        className="w-full"
        data-testid="legacy-data-open"
        disabled={busy || (!personal && !authed)}
        onClick={() => void inspect()}
      >
        查看并接续旧资料
      </Button>
      {!personal && !authed && (
        <p className="text-xs text-muted-foreground">
          进入个人工作区或登录团队后，可选择旧资料的归属。
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>接续旧资料</DialogTitle>
            <DialogDescription>
              将选定资料复制到当前工作区。旧文件继续保留；当前已有资料的类别不会被覆盖。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted p-3 text-sm break-words">当前工作区：{target}</div>
          {selected ? (
            <div className="grid gap-3">
              <p className="font-medium">
                接续：{labels[selected.category]}
                {selected.label ? ` · ${selected.label}` : ''}
              </p>
              <p className="text-sm text-muted-foreground break-all">
                来源：{selected.sourcePath || '上次未完成的接续'}
              </p>
              {selected.category === 'chat' && (
                <p className="text-sm text-muted-foreground">
                  同一来源的旧聊天可能包含不同账号的历史，请确认这一组属于当前账号。其他来源组会留在旧文件中。
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                {personal
                  ? '这些资料只保存在个人工作区，不会上传到团队服务器。'
                  : '接续后，这类资料会沿用当前团队账号的同步规则。聊天历史仅作为本机记录，不会重新发送。'}
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                我确认这类旧资料属于上面显示的工作区，并按上述方式接续。
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive break-words">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => setSelected(null)}>
                  返回
                </Button>
                <Button disabled={busy || !confirmed} onClick={() => void importSelected()}>
                  {busy ? '接续中…' : '确认接续'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              {items.map((item) => (
                <div key={item.category} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{labels[item.category]}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.available
                          ? `${item.fileCount} 个文件 · ${Math.ceil(item.bytes / 1024)} KB`
                          : '没有发现旧资料'}
                      </p>
                    </div>
                    {item.category !== 'chat' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!item.canImport || busy}
                        data-testid={`legacy-data-${item.category}`}
                        onClick={() => choose(item)}
                      >
                        接续
                      </Button>
                    )}
                  </div>
                  {item.message && (
                    <p className="mt-2 text-xs text-muted-foreground">{item.message}</p>
                  )}
                  {item.reason === 'already-imported' && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      这类资料已接续，无需重复导入。
                    </p>
                  )}
                  {item.groups?.map((group) => (
                    <div key={group.group} className="mt-2 flex items-center justify-between gap-2">
                      <span className="min-w-0 break-all text-xs">{group.label}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!group.canImport || busy}
                        data-testid="legacy-data-chat"
                        onClick={() => choose(group)}
                      >
                        接续此来源
                      </Button>
                    </div>
                  ))}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                暂不接续也可以继续使用。之后可随时回到账户页查看。
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
