import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Plus, Settings2, TerminalSquare, X } from 'lucide-react'
import { PanelScaffold } from './PanelScaffold'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { ErrorNotice } from '@/components/ErrorNotice'
import { api } from '@/lib/api'
import { settingsPrincipalRuntime } from '@/lib/settingsPrincipalRuntime'
import { useUserDataTransitionVersion } from '@/lib/userDataTransitionState'
import { useAuthStore } from '@/store/useAuthStore'
import { useAppStore } from '@/store/useAppStore'
import type { TerminalSession, TerminalEvent } from '@/types/api'

type Request = (action: string, payload?: unknown) => Promise<unknown>

// The existing UI library owns all controls; xterm supplies only the terminal emulator.
function TerminalSurface({
  session,
  request,
  onError,
  snapshot,
  visible,
}: {
  session: TerminalSession
  request: Request
  onError: (e: unknown) => void
  snapshot: { principalId: string; generation: number }
  visible: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const ended = useRef(session.ended)
  useEffect(() => {
    ended.current = session.ended
  }, [session.ended])
  const dark = useAppStore((s) => s.dark)
  useEffect(() => {
    if (!host.current) return
    const term = new Terminal({
      cursorBlink: true,
      scrollback: 3000,
      fontSize: 13,
      fontFamily: getComputedStyle(host.current).fontFamily,
      allowProposedApi: false,
    })
    const sizing = new FitAddon()
    term.loadAddon(sizing)
    term.open(host.current)
    terminal.current = term
    fit.current = sizing
    let disposed = false
    let attached = false
    let sequence = -1
    const queue: TerminalEvent[] = []
    const receive = (e: TerminalEvent) => {
      if (
        disposed ||
        e.id !== session.id ||
        e.principalId !== snapshot.principalId ||
        e.generation !== snapshot.generation
      )
        return
      if (!attached) {
        queue.push(e)
        return
      }
      if (e.type === 'data' && (e.sequence ?? -1) > sequence) {
        sequence = e.sequence!
        const text = e.data || ''
        term.write(text, () => {
          if (!disposed) void request('ack', { id: session.id, count: text.length }).catch(onError)
        })
      }
      if (e.type === 'exit') term.writeln(`\r\n[会话已结束，退出码 ${e.exitCode ?? ''}]`)
    }
    const unsubscribe = api.onTerminalEvent(receive)
    void request('attach', { id: session.id })
      .then((value) => {
        if (disposed) return
        const result = value as TerminalSession & { buffer: string; sequence: number }
        sequence = result.sequence
        term.write(result.buffer)
        attached = true
        queue.forEach(receive)
        if (result.ended) term.writeln(`\r\n[会话已结束，退出码 ${result.exitCode ?? ''}]`)
      })
      .catch(onError)
    const input = term.onData((data) => {
      // Chunk large bracketed paste input; the PTY receives the original stream in order.
      for (let i = 0; i < data.length; ) {
        let end = Math.min(i + 16384, data.length)
        const last = data.charCodeAt(end - 1)
        if (end < data.length && last >= 0xd800 && last <= 0xdbff) end--
        void request('write', { id: session.id, data: data.slice(i, end) }).catch(onError)
        i = end
      }
    })
    const resize = term.onResize(({ cols, rows }) => {
      if (!ended.current) void request('resize', { id: session.id, cols, rows }).catch(onError)
    })
    const observer = new ResizeObserver(() => {
      if (host.current?.clientWidth && host.current?.clientHeight) sizing.fit()
    })
    observer.observe(host.current)
    return () => {
      disposed = true
      unsubscribe()
      input.dispose()
      resize.dispose()
      observer.disconnect()
      term.dispose()
      terminal.current = null
      fit.current = null
    }
  }, [session.id, request, onError, snapshot.principalId, snapshot.generation]) // lifetime belongs to the session, not panel visibility
  useEffect(() => {
    if (!terminal.current || !host.current) return
    const css = getComputedStyle(host.current)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')!
    const color = (token: string) => {
      ctx.fillStyle = css.getPropertyValue(token).trim()
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
    }
    terminal.current.options.theme = {
      background: color('--background'),
      foreground: color('--foreground'),
      cursor: color('--primary'),
      selectionBackground: color('--muted'),
    }
  }, [dark])
  useEffect(() => {
    if (visible) fit.current?.fit()
  }, [visible])
  return <div ref={host} className="h-full min-h-0 w-full font-mono" aria-label="本地终端" />
}

export default function TerminalPanel({ visible }: { visible: boolean }) {
  const token = useAuthStore((s) => s.token)
  const version = useUserDataTransitionVersion()
  const { principalId, generation } = settingsPrincipalRuntime.current()
  const request = useCallback<Request>(
    (action, payload) => api.terminal(action, payload, { principalId, generation }),
    [principalId, generation],
  )
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [active, setActive] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [command, setCommand] = useState('')
  const alive = useRef(true)
  const revision = useRef(0)
  const invalidate = useCallback(() => {
    revision.current++
  }, [])
  const onError = useCallback((e: unknown) => {
    if (alive.current) setError(e)
  }, [])
  const authorize = useCallback(async () => {
    const stamp = ++revision.current
    setBusy(true)
    setError(null)
    try {
      const result = (await request('authorize', { token })) as {
        settings: { startupCommand: string }
        sessions: TerminalSession[]
      }
      if (
        !alive.current ||
        revision.current !== stamp ||
        settingsPrincipalRuntime.current().generation !== generation
      )
        return
      setCommand(result.settings.startupCommand)
      setSessions(result.sessions)
      setReady(true)
      setActive((current) =>
        result.sessions.some((s) => s.id === current) ? current : result.sessions[0]?.id || '',
      )
    } catch (e) {
      if (alive.current && revision.current === stamp) {
        onError(e)
        setReady(false)
      }
    } finally {
      if (alive.current && revision.current === stamp) setBusy(false)
    }
  }, [request, token, generation, onError])
  const initialized = useRef('')
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      invalidate()
      initialized.current = ''
      void request('close-all').catch(() => {})
    }
  }, [request, invalidate])
  useEffect(() => {
    if ((visible || initialized.current) && initialized.current !== token) {
      initialized.current = token
      void authorize()
    }
  }, [visible, authorize, version, token])
  useEffect(
    () =>
      api.onTerminalEvent((e) => {
        if (e.principalId !== principalId || e.generation !== generation) return
        if (e.type === 'unavailable') {
          revision.current++
          setBusy(false)
          setError(new Error(e.message))
          setReady(false)
          setSessions([])
          setActive('')
        }
        if (e.type === 'exit')
          setSessions((all) =>
            all.map((s) =>
              s.id === e.id ? { ...s, ended: true, exitCode: e.exitCode ?? null } : s,
            ),
          )
      }),
    [principalId, generation],
  )
  const create = async () => {
    const stamp = revision.current
    setBusy(true)
    setError(null)
    try {
      const session = (await request('create')) as TerminalSession
      if (!alive.current || revision.current !== stamp) return
      setSessions((all) => [...all, session])
      setActive(session.id)
    } catch (e) {
      onError(e)
    } finally {
      if (alive.current && revision.current === stamp) setBusy(false)
    }
  }
  const close = async () => {
    try {
      await request('close', { id: active })
      const remaining = sessions.filter((s) => s.id !== active)
      setSessions(remaining)
      setActive(remaining[0]?.id || '')
    } catch (e) {
      onError(e)
    }
  }
  const save = async () => {
    setBusy(true)
    try {
      await request('settings', { startupCommand: command })
      setSettingsOpen(false)
      setError(null)
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <PanelScaffold
      icon={TerminalSquare}
      title="终端"
      hint="本机 shell · 可直接使用 SSH"
      scrollable={false}
      toolbar={
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={!ready || busy}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 />
            启动设置
          </Button>
          <Button size="sm" disabled={!ready || busy} onClick={() => void create()}>
            <Plus />
            新建终端
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-3 p-4">
        {error != null && (
          <div className="space-y-2">
            <ErrorNotice error={error} context="终端" />
            {ready && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void authorize()}>
                重新验证权限
              </Button>
            )}
          </div>
        )}
        {!ready && (
          <div className="flex flex-1 items-center justify-center">
            <Button variant="outline" disabled={busy} onClick={() => void authorize()}>
              {busy ? '正在验证高级权限…' : '重新验证权限'}
            </Button>
          </div>
        )}
        {ready && sessions.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <p>使用本机默认 shell 和现有环境，无需填写服务器或代理地址。</p>
            <Button variant="outline" disabled={busy} onClick={() => void create()}>
              <Plus />
              打开本地终端
            </Button>
          </div>
        )}
        {ready && sessions.length > 0 && (
          <Tabs value={active} onValueChange={setActive} className="min-h-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden pb-2">
                <TabsList variant="line">
                  {sessions.map((s, i) => (
                    <TabsTrigger key={s.id} value={s.id}>
                      {s.title} {i + 1}
                      {s.ended ? ' · 已退出' : ''}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              <Button
                variant="ghost"
                size="icon"
                disabled={busy}
                aria-label="关闭当前终端"
                onClick={() => void close()}
              >
                <X />
              </Button>
            </div>
            {sessions.map((s) => (
              <TabsContent
                key={s.id}
                value={s.id}
                forceMount
                className="min-h-0 overflow-hidden rounded-md border border-border bg-background p-2 data-[state=inactive]:hidden"
              >
                <TerminalSurface
                  session={s}
                  request={request}
                  onError={onError}
                  snapshot={{ principalId, generation }}
                  visible={visible && active === s.id}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>终端启动设置</DialogTitle>
            <DialogDescription>
              仅影响此账号新建的本地终端，不修改系统 shell 配置。SSH 在终端中手动使用。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="terminal-startup-command">启动指令（可选）</Label>
            <Input
              id="terminal-startup-command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              maxLength={8192}
              placeholder="留空使用正常的本机 shell"
            />
            <p className="text-xs text-muted-foreground">
              在本机执行后进入交互式 shell。只填写你信任的指令；不要在这里保存密码或密钥。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>
              取消
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PanelScaffold>
  )
}
