import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/useAppStore'
import { buildOnboardingSteps } from '@/lib/onboardingSteps'

// 分步高亮新手导览 (类 sub2api 引导): 首次进入主界面自动开, 也可在标题栏「?」手动重开。
// 通过 data-tour="nav-xxx" 锚点定位侧栏项, 用 box-shadow 镂空高亮 + 浮动卡片逐步讲解。
// 完成/跳过后写 settings.ui.onboarding_done, 不再自动弹。

const PAD = 6 // 高亮框相对目标的外扩

export function Onboarding() {
  const open = useAppStore((s) => s.tourOpen)
  const setTourOpen = useAppStore((s) => s.setTourOpen)
  const patchSection = useAppStore((s) => s.patchSection)
  const sidebarSide = useAppStore((s) => s.sidebarSide)
  const meta = useAppStore((s) => s.meta)

  const brand = String((meta?.productName as string) || 'ShareGPT').replace(
    /\s+(Sender|Receiver)$/i,
    '',
  )
  const steps = buildOnboardingSteps(brand)

  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  const step = steps[index]
  const targetSel = step?.target

  // 测量当前步骤锚点位置 (目标不存在时退化为居中卡)。
  const measure = useCallback(() => {
    if (!targetSel) {
      setRect(null)
      return
    }
    const el = document.querySelector<HTMLElement>(`[data-tour="${targetSel}"]`)
    setRect(el ? el.getBoundingClientRect() : null)
  }, [targetSel])

  // 打开时从第一步开始。
  useEffect(() => {
    if (open) setIndex(0)
  }, [open])

  // 步骤变化/窗口尺寸变化时重新测量; rAF 双跳过等待布局稳定 (侧栏宽度等过渡)。
  useLayoutEffect(() => {
    if (!open) return
    let raf = 0
    const run = () => {
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(measure)
      })
    }
    run()
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
    }
  }, [open, index, measure])

  const finish = useCallback(() => {
    setTourOpen(false)
    void patchSection('ui', { onboarding_done: true }).catch(() => undefined)
  }, [setTourOpen, patchSection])

  const next = useCallback(() => {
    setIndex((i) => {
      if (i >= steps.length - 1) {
        finish()
        return i
      }
      return i + 1
    })
  }, [steps.length, finish])

  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  // 键盘: Esc 跳过, →/Enter 下一步, ← 上一步。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, finish, next, prev])

  if (!open || !step) return null

  const last = index === steps.length - 1
  const counter = `${index + 1} / ${steps.length}`

  // 浮动卡片定位: 有锚点时贴在目标侧栏一侧(侧栏在左->卡片在右, 反之), 并夹在视口内; 无锚点居中。
  const CARD_W = 320
  let cardStyle: CSSProperties
  if (rect) {
    const gap = 16
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = sidebarSide === 'left' ? rect.right + PAD + gap : rect.left - PAD - gap - CARD_W
    left = Math.min(Math.max(12, left), vw - CARD_W - 12)
    let top = rect.top - 8
    top = Math.min(Math.max(12, top), vh - 220)
    cardStyle = { position: 'fixed', left, top, width: CARD_W }
  } else {
    cardStyle = {
      position: 'fixed',
      left: '50%',
      top: '50%',
      width: CARD_W,
      transform: 'translate(-50%, -50%)',
    }
  }

  return (
    <div className="fixed inset-0 z-[60]">
      {/* 点击遮罩层: 拦截除卡片外的一切点击, 避免引导中误触 (无锚点时直接当暗幕)。 */}
      <div
        className="absolute inset-0"
        style={{ background: rect ? 'transparent' : 'rgba(0,0,0,0.55)' }}
        onClick={() => undefined}
      />

      {/* 镂空高亮: box-shadow 把目标以外区域压暗, 目标处保持明亮并描边。 */}
      {rect && (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-primary transition-all duration-200"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
          }}
        />
      )}

      {/* 讲解卡片。 */}
      <div style={cardStyle} className="rounded-2xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-1 text-xs font-medium text-primary">{counter}</div>
        <h3 className="text-base font-semibold">{step.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={finish}>
            跳过
          </Button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button variant="outline" size="sm" onClick={prev}>
                上一步
              </Button>
            )}
            <Button size="sm" onClick={next}>
              {last ? '开始使用' : '下一步'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
