interface NavTooltipFrameCommitOptions {
  nextFrame: () => Promise<void>
  isCurrent: () => boolean
  reveal: () => void
}

export async function commitNavTooltipFrame({
  nextFrame,
  isCurrent,
  reveal,
}: NavTooltipFrameCommitOptions): Promise<boolean> {
  await nextFrame()
  await nextFrame()
  if (!isCurrent()) return false

  reveal()

  await nextFrame()
  await nextFrame()
  return isCurrent()
}
