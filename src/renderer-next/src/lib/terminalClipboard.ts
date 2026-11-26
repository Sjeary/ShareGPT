type CopyKey = Pick<
  KeyboardEvent,
  | 'type'
  | 'key'
  | 'metaKey'
  | 'ctrlKey'
  | 'shiftKey'
  | 'altKey'
  | 'repeat'
  | 'preventDefault'
  | 'stopPropagation'
>

// Read xterm's selection: terminal output is not a browser DOM selection.
export function handleTerminalCopy(
  event: CopyKey,
  platform: string,
  selection: () => string,
  writeText: (text: string) => Promise<void>,
  onError: (error: unknown) => void,
): boolean {
  const shortcut =
    (event.metaKey && !event.ctrlKey && !event.shiftKey) ||
    (event.ctrlKey && !event.metaKey && (event.shiftKey || platform !== 'darwin'))
  if (event.type !== 'keydown' || event.key.toLowerCase() !== 'c' || event.altKey || !shortcut)
    return true
  const text = selection()
  if (!text) return true
  event.preventDefault()
  event.stopPropagation()
  if (!event.repeat)
    void Promise.resolve()
      .then(() => writeText(text))
      .catch(onError)
  return false
}
