import { useState } from 'react'
import { toast } from 'sonner'
import { FileDown, FolderInput } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { useChatStore, type ChatMessage } from '@/store/useChatStore'

// 导入配置 / 导入本机资料包。
// 移植自旧 renderer.js handleImportConfig (~5462) / handleImportUserData (~5479):
//   - importSettings(): 选择 settings.json 导入, 成功后写入 state.settings 并刷新表单。
//   - importUserData(): 导入本机资料包 { settings, chatHistory }, 刷新设置并重灌聊天历史。
// 这里成功后统一调 useAppStore.reloadSettings() 让新渲染层各面板重新读取设置;
// 资料包额外把 chatHistory.conversations 灌进 useChatStore (对齐旧 hydrateConversationStore reset)。

interface ImportUserDataPayload {
  settings?: unknown
  chatHistory?: { conversations?: Record<string, ChatMessage[]> } | null
  filePath?: string
}

export function ImportActions() {
  const reloadSettings = useAppStore((s) => s.reloadSettings)
  const [busy, setBusy] = useState<'settings' | 'userData' | null>(null)

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
      const payload = (await api.importUserData()) as ImportUserDataPayload | undefined | null
      if (!payload) return
      // 设置部分: 资料包内含 settings 时也以磁盘为准重新加载, 保证各面板同步。
      await reloadSettings()
      // 聊天历史部分: 对齐旧 hydrateConversationStore(payload.chatHistory, { reset: true })。
      const conversations = payload.chatHistory?.conversations
      if (conversations && typeof conversations === 'object') {
        useChatStore.getState().hydrate(conversations)
      }
      toast.success('本机资料包已导入')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入资料包失败')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-2">
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
    </div>
  )
}
