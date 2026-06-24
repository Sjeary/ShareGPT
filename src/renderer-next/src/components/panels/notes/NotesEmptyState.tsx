import { BookText, FilePlus2, FolderInput, FolderCog } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useVaultStore } from '@/store/useVaultStore'
import { inputPrompt } from './InputPrompt'

// 知识库为空时的引导: 新建 / 导入 Obsidian 库 / 选择文件夹作为 vault。
export function NotesEmptyState() {
  const root = useVaultStore((s) => s.root)
  const createNote = useVaultStore((s) => s.createNote)
  const importVault = useVaultStore((s) => s.importVault)
  const setRootViaDialog = useVaultStore((s) => s.setRootViaDialog)

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center animate-in fade-in duration-300">
      <div className="flex size-20 items-center justify-center rounded-2xl bg-primary/10">
        <BookText className="size-10 text-primary" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold">你的知识库还是空的</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          这里的笔记就是磁盘上真实的 <code className="rounded bg-muted px-1">.md</code>{' '}
          文件，支持双链 <code className="rounded bg-muted px-1">[[ ]]</code>
          、反链、全文检索与图谱， 可随时被 Obsidian 直接打开。
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <Button
          onClick={async () => {
            const name = await inputPrompt('新建笔记 (相对路径)', '未命名.md')
            if (name && name.trim()) {
              try {
                await createNote(name.trim())
              } catch (e) {
                toast.error(e instanceof Error ? e.message : '创建失败')
              }
            }
          }}
        >
          <FilePlus2 className="size-4" /> 新建第一篇
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            const r = await importVault()
            if (r) toast.success(`已导入 ${r.notes} 篇笔记、${r.attachments} 个附件`)
          }}
        >
          <FolderInput className="size-4" /> 导入 Obsidian 库
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            const ok = await setRootViaDialog()
            if (ok) toast.success('已切换知识库文件夹')
          }}
        >
          <FolderCog className="size-4" /> 选择文件夹
        </Button>
      </div>
      {root && (
        <p className="max-w-lg truncate text-xs text-muted-foreground/70" title={root}>
          当前库目录：{root}
        </p>
      )}
    </div>
  )
}
