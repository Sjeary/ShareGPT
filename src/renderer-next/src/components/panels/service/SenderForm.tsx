import { useMemo, useState } from 'react'
import { Play, Square, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store/useAppStore'
import { api } from '@/lib/api'
import type { SenderSettings } from '@/types/settings'
import { Field } from './Field'
import { FALLBACK_MODES, isPortNumber, isSenderRunning, safeText } from './helpers'

const EMPTY: SenderSettings = {
  proxy_server: '',
  proxy_port: '',
  proxy_uuid: '',
  socks_listen_port: '',
  fallback_mode: 'system_proxy',
  fallback_local_port: '',
  target_domains: '',
}

export function SenderForm() {
  const settings = useAppStore((s) => s.settings)
  const status = useAppStore((s) => s.status)
  const patchSection = useAppStore((s) => s.patchSection)
  const [busy, setBusy] = useState(false)

  const running = isSenderRunning(status)

  const form = useMemo<SenderSettings>(
    () => ({ ...EMPTY, ...(settings?.sender ?? {}) }),
    [settings?.sender],
  )

  const directMode = form.fallback_mode === 'direct'
  // 运行中或正在启停时锁定表单。
  const locked = running || busy

  function update(patch: Partial<SenderSettings>) {
    void patchSection('sender', patch)
  }

  // 移植旧版启动前校验: 已填服务器时, 端口必须是数字, uuid 必填。
  function validate(): string | null {
    const server = safeText(form.proxy_server)
    if (!server) return '请先填写服务器地址，再开启发送服务'
    if (!isPortNumber(safeText(form.proxy_port))) return '连接端口必须为数字'
    if (!safeText(form.proxy_uuid)) return '请填写连接身份码'
    const socks = safeText(form.socks_listen_port)
    if (socks && !isPortNumber(socks)) return '本地代理端口必须为数字'
    if (!directMode) {
      const fb = safeText(form.fallback_local_port)
      if (fb && !isPortNumber(fb)) return '本机已有代理端口必须为数字'
    }
    return null
  }

  async function handleStart() {
    const err = validate()
    if (err) {
      toast.error(err)
      return
    }
    setBusy(true)
    try {
      await api.startSender({ ...form })
      toast.success('发送服务已开启')
    } catch (e) {
      toast.error((e as Error)?.message || '开启发送服务失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleStop() {
    setBusy(true)
    try {
      await api.stopSender()
      toast.success('已发送停止指令')
    } catch (e) {
      toast.error((e as Error)?.message || '停止发送服务失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        填写连接信息后，可开启发送端，让需要的网站通过这台设备访问。
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="s_proxy_server"
          label="服务器地址"
          value={form.proxy_server}
          placeholder="例如 203.0.113.10 或 demo.example.com"
          disabled={locked}
          onChange={(v) => update({ proxy_server: v })}
        />
        <Field
          id="s_proxy_port"
          label="连接端口"
          value={form.proxy_port}
          placeholder="例如 443"
          disabled={locked}
          onChange={(v) => update({ proxy_port: v })}
        />
        <Field
          id="s_proxy_uuid"
          label="连接身份码"
          value={form.proxy_uuid}
          placeholder="请输入连接身份码"
          disabled={locked}
          onChange={(v) => update({ proxy_uuid: v })}
        />
        <Field
          id="s_socks_listen_port"
          label="本地代理端口"
          value={form.socks_listen_port}
          placeholder="例如 1080"
          disabled={locked}
          onChange={(v) => update({ socks_listen_port: v })}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="s_fallback_mode" className="text-xs text-muted-foreground">
            其他网站访问方式
          </Label>
          <select
            id="s_fallback_mode"
            value={form.fallback_mode || 'system_proxy'}
            disabled={locked}
            onChange={(e) => update({ fallback_mode: e.target.value })}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
          >
            {FALLBACK_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <Field
          id="s_fallback_local_port"
          label="本机已有代理端口"
          value={form.fallback_local_port}
          placeholder="例如 7890"
          disabled={locked || directMode}
          onChange={(v) => update({ fallback_local_port: v })}
          className={directMode ? 'opacity-50' : undefined}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="s_target_domains" className="text-xs text-muted-foreground">
          固定走连接的网站
        </Label>
        <textarea
          id="s_target_domains"
          rows={4}
          readOnly
          value={form.target_domains}
          placeholder="开启后由系统自动维护"
          className="resize-none rounded-md border border-input bg-muted/40 px-3 py-2 text-xs text-muted-foreground shadow-xs outline-none"
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        {running ? (
          <Button variant="destructive" disabled={busy} onClick={handleStop}>
            {busy ? <Loader2 className="animate-spin" /> : <Square />}
            停止发送服务
          </Button>
        ) : (
          <Button disabled={busy} onClick={handleStart}>
            {busy ? <Loader2 className="animate-spin" /> : <Play />}
            开启发送服务
          </Button>
        )}
      </div>
    </div>
  )
}
