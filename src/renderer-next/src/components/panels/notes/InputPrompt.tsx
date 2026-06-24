/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef } from 'react'
import { create } from 'zustand'

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

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.select(), 30)
  }, [open])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-[20vh] animate-in fade-in duration-150"
      onClick={cancel}
    >
      <div
        className="w-[min(440px,90vw)] overflow-hidden rounded-xl border border-border bg-popover shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pb-1 pt-3 text-sm font-medium">{title}</div>
        <div className="px-4 pb-3 pt-1">
          <input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              else if (e.key === 'Escape') cancel()
            }}
            autoFocus
            className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-primary/60"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-2.5">
          <button
            type="button"
            onClick={cancel}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
