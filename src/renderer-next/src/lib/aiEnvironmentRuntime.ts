import type { AiKind } from '@/store/useAiStore'

export interface AiEnvironmentOperation {
  kind: AiKind
  environmentId: string
  generation: number
}

const runtime: Record<AiKind, { environmentId: string; generation: number }> = {
  gpt: { environmentId: '', generation: 0 },
  gemini: { environmentId: '', generation: 0 },
  claude: { environmentId: '', generation: 0 },
}

export function startAiEnvironmentOperation(
  kind: AiKind,
  environmentId: string,
): AiEnvironmentOperation {
  const current = runtime[kind]
  current.environmentId = environmentId
  current.generation += 1
  return { kind, environmentId, generation: current.generation }
}

export function currentAiEnvironmentOperation(kind: AiKind): AiEnvironmentOperation {
  const current = runtime[kind]
  return { kind, environmentId: current.environmentId, generation: current.generation }
}

export function isCurrentAiEnvironmentOperation(operation: AiEnvironmentOperation): boolean {
  const current = runtime[operation.kind]
  return (
    current.generation === operation.generation && current.environmentId === operation.environmentId
  )
}
