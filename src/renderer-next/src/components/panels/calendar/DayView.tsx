import { TimeGridView } from './TimeGridView'

// 日视图: 单天喂给共用时间网格。
export function DayView({
  cursor,
  onPickSlot,
  onPickEvent,
}: {
  cursor: Date
  onPickSlot: (slotStart: Date) => void
  onPickEvent: (eventId: string) => void
}) {
  return <TimeGridView days={[cursor]} onPickSlot={onPickSlot} onPickEvent={onPickEvent} />
}
