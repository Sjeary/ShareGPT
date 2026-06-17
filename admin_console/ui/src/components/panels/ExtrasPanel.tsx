import { useEffect, useState } from 'react'
import { Braces, Save, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAdminStore } from '@/store/useAdminStore'
import type { Bootstrap } from '@/types/admin'
import { PanelScaffold } from './PanelScaffold'

export function ExtrasPanel() {
  const bootstrap = useAdminStore((s) => s.bootstrap)
  const saveBootstrap = useAdminStore((s) => s.saveBootstrap)

  const [text, setText] = useState('{}')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setText(JSON.stringify(bootstrap?.extra || {}, null, 2))
  }, [bootstrap?.extra])

  let parseError = ''
  try {
    JSON.parse(text || '{}')
  } catch (err) {
    parseError = err instanceof Error ? err.message : '无效的 JSON'
  }

  async function save() {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(text || '{}')
    } catch {
      toast.error('JSON 格式有误，请修正后再保存。')
      return
    }
    setBusy(true)
    try {
      const next: Bootstrap = {
        sender: bootstrap?.sender || {},
        update: bootstrap?.update || {},
        extra: parsed,
      }
      await saveBootstrap(next)
      toast.success('备用配置已保存。')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PanelScaffold
      icon={Braces}
      title="备用配置"
      hint="服务端 client_bootstrap.json 里的 extra 对象，预留给后续扩展"
    >
      <div className="grid max-w-3xl gap-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">额外 JSON</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={18}
              spellCheck={false}
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs leading-relaxed shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {parseError ? (
              <p className="text-xs text-destructive">JSON 解析错误：{parseError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">格式有效。</p>
            )}
            <div className="flex justify-end">
              <Button disabled={busy || Boolean(parseError)} onClick={() => void save()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                保存备用配置
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </PanelScaffold>
  )
}
