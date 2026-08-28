const KEYBOARD_NAVIGATION_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
])

export type NavTooltipInputModality = 'none' | 'pointer' | 'keyboard'

export function createNavTooltipInputState() {
  let modality: NavTooltipInputModality = 'none'
  let interactionSequence = 0

  return {
    invalidate() {
      modality = 'none'
      interactionSequence += 1
    },
    noteKeyboardKey(key: string) {
      if (!KEYBOARD_NAVIGATION_KEYS.has(key)) return false
      modality = 'keyboard'
      return true
    },
    notePointer() {
      modality = 'pointer'
    },
    nextInteractionId(triggerId: string) {
      interactionSequence += 1
      return `${triggerId}:${interactionSequence}`
    },
    canShowKeyboardFocus(input: {
      documentHasFocus: boolean
      isActiveElement: boolean
      isFocusVisible: boolean
    }) {
      return (
        modality === 'keyboard' &&
        input.documentHasFocus &&
        input.isActiveElement &&
        input.isFocusVisible
      )
    },
    getModality: () => modality,
  }
}
