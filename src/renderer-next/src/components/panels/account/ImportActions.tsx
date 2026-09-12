import { useState } from 'react'
import { toast } from 'sonner'
import { FileDown, FileUp, FolderInput } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import type { ChatMessage } from '@/store/useChatStore'
import { LegacyDataImport } from './LegacyDataImport'
import { withUserDataTransition } from '@/lib/userDataLifecycle'

// 导入配置 / 导入本机资料包。
// 移植自旧 renderer.js handleImportConfig (~5462) / handleImportUserData (~5479):
//   - importSettings(): 选择 settings.json 导入, 成功后写入 state.settings 并刷新表单。
//   - importUserData(): 导入本机资料包 { settings, chatHistory }, 刷新设置并重灌聊天历史。
// 这里成功后统一调 useAppStore.reloadSettings() 让新渲染层各面板重新读取设置;
// 资料通过同一生命周期入口完成保存与重载，不另建聊天缓存写入者。

interface ImportUserDataPayload {
  settings?: unknown
  chatHistory?: { conversations?: Record<string, ChatMessage[]> } | null
  filePath?: string
}

interface ExportUserDataPayload {
  filePath?: string
}

export function ImportActions() {
  const reloadSettings = useAppStore((s) => s.reloadSettings)
  const [busy, setBusy] = useState<'settings' | 'userData' | 'export' | null>(null)

  async function handleImportConfig() {
    if (busy) return
    setBusy('settings')
    try {
      const imported = await api.importSettings()
      // 旧版: 用户取消选择文件时返回 falsy, 不提示成功。
      if (!imported) return
      await reloadSettings()
      toast.success('已导入配置')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入配置失败')
    } finally {
      setBusy(null)
    }
  }

  async function handleImportUserData() {
    if (busy) return
    setBusy('userData')
    try {
      const payload = (await withUserDataTransition(() => api.importUserData(), {
        reload: true,
      })) as ImportUserDataPayload | undefined | null
      if (!payload) return
      // 设置部分: 资料包内含 settings 时也以磁盘为准重新加载, 保证各面板同步。
      await reloadSettings()
      toast.success('本机资料包已导入')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入资料包失败')
    } finally {
      setBusy(null)
    }
  }

  // 导出本机资料包 (settings + chatHistory)。
  // 移植自旧 renderer.js handleExportUserData(~5497): 用户取消(无 filePath)时静默。
  async function handleExportUserData() {
    if (busy) return
    setBusy('export')
    try {
      const payload = (await withUserDataTransition(() => api.exportUserData())) as
        | ExportUserDataPayload
        | undefined
        | null
      const filePath = payload?.filePath
      if (!filePath) return
      toast.success(`本机资料包已导出：${filePath}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出资料包失败')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-2">
      <LegacyDataImport />
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleImportConfig}
        disabled={busy !== null}
      >
        <FileDown />
        {busy === 'settings' ? '导入中…' : '导入配置'}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleImportUserData}
        disabled={busy !== null}
      >
        <FolderInput />
        {busy === 'userData' ? '导入中…' : '导入用户数据'}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleExportUserData}
        disabled={busy !== null}
      >
        <FileUp />
        {busy === 'export' ? '导出中…' : '导出用户数据'}
      </Button>
    </div>
  )
}
