import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CheckCircle2, ClipboardPaste, Link2, Loader2, TriangleAlert, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/hooks/useAuth'
import { authAttempts, runGuardedInviteRegistration } from '@/lib/authAttemptGuard'
import { parseInviteLink } from '@/lib/inviteLink'
import { useAppStore } from '@/store/useAppStore'

interface InvitePreview {
  valid: boolean
  note?: string
  expiresAt?: string
  maxUses?: number | null
  usedCount?: number
  remainingUses?: number | null
  reason?: string
  message?: string
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 10000,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null; text: string }> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  const externalSignal = init.signal
  const onExternalAbort = () => controller.abort()
  externalSignal?.addEventListener('abort', onExternalAbort)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const text = await response.text().catch(() => '')
    let data: Record<string, unknown> | null = null
    if (text) {
      try {
        const parsed = JSON.parse(text)
        if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
      } catch {
        /* plain text response */
      }
    }
    return { ok: response.ok, status: response.status, data, text }
  } catch (err) {
    if (externalSignal?.aborted) throw err
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('连接服务器超时，请检查邀请链接中的服务地址或网络', { cause: err })
    }
    throw new Error('无法连接到团队服务器，请检查邀请链接或网络', { cause: err })
  } finally {
    window.clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

export function InviteRegisterForm({
  onRegisteredNeedManualLogin,
}: {
  onRegisteredNeedManualLogin?: (info: { serverUrl: string; username: string }) => void
}) {
  const { login } = useAuth()
  const patchSection = useAppStore((s) => s.patchSection)

  const [rawLink, setRawLink] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [rememberPassword, setRememberPassword] = useState(true)

  const [previewLoading, setPreviewLoading] = useState(false)
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [previewError, setPreviewError] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)
  const [errorShakeKey, setErrorShakeKey] = useState(0)

  const mountedRef = useRef(true)
  const submitBusyRef = useRef(false)
  const submitControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      submitControllerRef.current?.abort()
      submitControllerRef.current = null
    }
  }, [])

  const parsed = useMemo(() => parseInviteLink(rawLink), [rawLink])

  useEffect(() => {
    setPreview(null)
    setPreviewError('')
    if (!parsed) {
      setPreviewLoading(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setPreviewLoading(true)
      void fetchJsonWithTimeout(
        `${parsed.serverUrl}/api/invite/preview?code=${encodeURIComponent(parsed.code)}`,
        { method: 'GET', signal: controller.signal },
      )
        .then(({ ok, data, text }) => {
          if (controller.signal.aborted) return
          if (ok && data?.valid === true) {
            setPreview({
              valid: true,
              note: String(data.note || ''),
              expiresAt: String(data.expiresAt || ''),
              maxUses:
                typeof data.maxUses === 'number' || data.maxUses === null ? data.maxUses : null,
              usedCount: Number(data.usedCount || 0),
              remainingUses:
                typeof data.remainingUses === 'number' || data.remainingUses === null
                  ? data.remainingUses
                  : null,
            })
            setPreviewError('')
          } else {
            const msg = String(data?.message || text || '邀请链接无效或已失效')
            setPreview({ valid: false, reason: String(data?.reason || 'invalid'), message: msg })
            setPreviewError(msg)
          }
        })
        .catch((err) => {
          if (controller.signal.aborted) return
          setPreview(null)
          setPreviewError(err instanceof Error ? err.message : '校验邀请链接失败')
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreviewLoading(false)
        })
    }, 220)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [parsed])

  function failValidation(message: string) {
    setSubmitError(message)
    setErrorShakeKey((k) => k + 1)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitBusyRef.current || submitting) return
    setSubmitError(null)

    if (!parsed) {
      failValidation('请先粘贴有效的邀请链接（如 sharegpt://invite?...）')
      return
    }
    const trimmedUser = username.trim()
    if (trimmedUser.length < 2 || trimmedUser.length > 40 || /[\s:]/.test(trimmedUser)) {
      failValidation('用户名需为 2–40 个字符，且不能包含空格或冒号')
      return
    }
    if (password.length < 6 || !password.trim()) {
      failValidation('密码至少需要 6 位，且不能全为空格')
      return
    }
    if (password !== confirmPassword) {
      failValidation('两次输入的密码不一致')
      return
    }

    submitControllerRef.current?.abort()
    const controller = new AbortController()
    submitControllerRef.current = controller
    submitBusyRef.current = true
    setSubmitting(true)

    try {
      await runGuardedInviteRegistration({
        coordinator: authAttempts,
        signal: controller.signal,
        register: async (signal) => {
          const reg = await fetchJsonWithTimeout(`${parsed.serverUrl}/api/invite/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({
              code: parsed.code,
              username: trimmedUser,
              password,
              displayName: displayName.trim() || undefined,
            }),
          })
          if (!reg.ok) {
            const message = String(reg.data?.message || reg.text || `注册失败（${reg.status}）`)
            throw new Error(message)
          }
          return { username: String(reg.data?.username || trimmedUser) }
        },
        afterRegistered: async () => {
          await patchSection('ui', { workspace_entry_intro_done: true }).catch(() => undefined)
        },
        loginWithAttempt: (registeredUsername, attempt) =>
          login({
            serverUrl: parsed.serverUrl,
            username: registeredUsername,
            password,
            rememberPassword,
            attempt,
          }),
        onCompleted: (profile) => {
          toast.success(`注册并登录成功，欢迎 ${profile.displayName}`)
        },
        onLoginFallback: (registeredUsername) => {
          if (!mountedRef.current) return
          toast.success('账号已注册成功，请直接使用新账号登录')
          onRegisteredNeedManualLogin?.({
            serverUrl: parsed.serverUrl,
            username: registeredUsername,
          })
        },
      })
    } catch (err) {
      if (mountedRef.current && !controller.signal.aborted) {
        setSubmitError(err)
        setErrorShakeKey((k) => k + 1)
      }
    } finally {
      if (submitControllerRef.current === controller) submitControllerRef.current = null
      submitBusyRef.current = false
      if (mountedRef.current) setSubmitting(false)
    }
  }

  async function handlePasteClipboard() {
    if (submitting) return
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (!text) {
        toast.info('剪贴板为空，请先复制管理员发送的邀请链接')
        return
      }
      setRawLink(text)
      if (parseInviteLink(text)) {
        toast.success('已识别剪贴板中的邀请链接')
      } else {
        toast.warning('已粘贴内容，但未识别到有效邀请链接')
      }
    } catch {
      toast.error('无法读取剪贴板，请手动按 Ctrl+V / Cmd+V 粘贴')
    }
  }

  return (
    <form className="grid gap-3.5" onSubmit={handleSubmit}>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="invite-link-input">邀请链接</Label>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={submitting}
            onClick={() => void handlePasteClipboard()}
            className="h-6 px-2 text-xs text-primary hover:text-primary"
          >
            <ClipboardPaste className="size-3" />
            粘贴剪贴板
          </Button>
        </div>
        <textarea
          id="invite-link-input"
          rows={2}
          spellCheck={false}
          value={rawLink}
          onChange={(e) => setRawLink(e.target.value)}
          disabled={submitting}
          placeholder="粘贴管理员发给你的邀请链接（sharegpt://invite?...）"
          className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none transition-[color,border-color,box-shadow,background-color] duration-150 ease-out hover:border-muted-foreground/45 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
        />
        {rawLink.trim() && !parsed && (
          <p className="motion-tab-panel flex items-center gap-1.5 text-xs text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" />
            未识别到有效的邀请链接，请确认完整复制了 sharegpt://invite?... 链接。
          </p>
        )}
        {parsed && previewLoading && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            正在校验邀请链接…
          </p>
        )}
        {parsed && !previewLoading && preview?.valid && (
          <div className="motion-tab-panel flex items-start gap-2.5 rounded-lg border border-success/40 bg-success/10 px-3 py-2.5 text-xs">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium text-foreground">
                邀请链接有效{preview.note ? ` · ${preview.note}` : ''}
              </p>
              <p className="truncate text-muted-foreground">服务器：{parsed.serverUrl}</p>
              <p className="text-muted-foreground">
                {preview.remainingUses === null
                  ? '不限次数'
                  : `剩余可用 ${preview.remainingUses} 次`}
                {preview.expiresAt
                  ? ` · 有效期至 ${new Date(preview.expiresAt).toLocaleString()}`
                  : ' · 永不过期'}
              </p>
            </div>
          </div>
        )}
        {parsed && !previewLoading && previewError && (
          <div className="motion-tab-panel flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">{previewError}</span>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="invite-username">用户名</Label>
          <Input
            id="invite-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="2–40 位，不含空格"
            disabled={submitting}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="invite-display-name">显示名（可选）</Label>
          <Input
            id="invite-display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="留空则同用户名"
            disabled={submitting}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="invite-password">设置密码</Label>
          <Input
            id="invite-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="至少 6 位"
            disabled={submitting}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="invite-confirm-password">确认密码</Label>
          <Input
            id="invite-confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="再次输入密码"
            disabled={submitting}
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/25 px-3 py-2">
        <Label htmlFor="invite-remember" className="cursor-pointer text-sm font-normal">
          记住密码并自动登录
        </Label>
        <Switch
          id="invite-remember"
          checked={rememberPassword}
          onCheckedChange={setRememberPassword}
          disabled={submitting}
        />
      </div>

      {Boolean(submitError) && (
        <div key={errorShakeKey} className="motion-shake">
          <ErrorNotice error={submitError} context="邀请链接注册" />
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={submitting || !parsed || (preview !== null && !preview.valid)}
      >
        {submitting ? (
          <>
            <Loader2 className="animate-spin" />
            正在注册并登录…
          </>
        ) : (
          <>
            {parsed ? <UserPlus /> : <Link2 />}
            注册并登录
          </>
        )}
      </Button>
    </form>
  )
}
