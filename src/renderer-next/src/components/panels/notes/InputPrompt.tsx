/* eslint-disable react-refresh/only-export-components */
import { useRef } from 'react'
import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

// Electron 不实现 window.prompt(返回 null), 故自建一个 Promise 化的输入弹窗。
interface PromptState {
  open: boolean
  title: string
  value: string
  placeholder: string
  resolve: ((v: string | null) => void) | null
  setValue: (v: string) => void
  ask: (title: string, def?: string, placeholder?: string) => Promise<string | null>
  submit: () => void
  cancel: () => void
}

const useInputPrompt = create<PromptState>((set, get) => ({
  open: false,
  title: '',
  value: '',
  placeholder: '',
  resolve: null,
  setValue: (value) => set({ value }),
  ask: (title, def = '', placeholder = '') =>
    new Promise<string | null>((resolve) =>
      set({ open: true, title, value: def, placeholder, resolve }),
    ),
  submit: () => {
    const { resolve, value } = get()
    set({ open: false, resolve: null })
    resolve?.(value)
  },
  cancel: () => {
    const { resolve } = get()
    set({ open: false, resolve: null })
    resolve?.(null)
  },
}))

// 在任意处调用: const name = await inputPrompt('标题', '默认值')
export const inputPrompt = (title: string, def?: string, placeholder?: string) =>
  useInputPrompt.getState().ask(title, def, placeholder)

export function InputPromptDialog() {
  const open = useInputPrompt((s) => s.open)
  const title = useInputPrompt((s) => s.title)
  const value = useInputPrompt((s) => s.value)
  const placeholder = useInputPrompt((s) => s.placeholder)
  const setValue = useInputPrompt((s) => s.setValue)
  const submit = useInputPrompt((s) => s.submit)
  const cancel = useInputPrompt((s) => s.cancel)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && cancel()}>
      <DialogContent
        className="top-[20vh] z-[61] w-[min(440px,90vw)] translate-y-0 gap-0 overflow-hidden p-0"
        overlayClassName="z-[60]"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.select()
        }}
      >
        <DialogHeader className="px-4 pb-1 pt-3">
          <DialogTitle className="text-sm font-medium">{title}</DialogTitle>
        </DialogHeader>
        <div className="px-4 pb-3 pt-1">
          <Input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
            autoFocus
          />
        </div>
        <DialogFooter className="flex-row justify-end gap-2 border-t border-border px-4 py-2.5 sm:justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={cancel}>
            取消
          </Button>
          <Button type="button" size="sm" onClick={submit}>
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
