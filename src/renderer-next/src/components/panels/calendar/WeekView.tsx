import { eachDayOfInterval, endOfWeek, startOfWeek } from 'date-fns'
import { TimeGridView } from './TimeGridView'

const WEEK_OPTS = { weekStartsOn: 1 } as const // 周一为首

// 周视图: 以 cursor 所在周 (周一~周日) 喂给共用时间网格。
export function WeekView({
  cursor,
  onPickSlot,
  onPickEvent,
}: {
  cursor: Date
  onPickSlot: (slotStart: Date) => void
  onPickEvent: (eventId: string) => void
}) {
  const start = startOfWeek(cursor, WEEK_OPTS)
  const end = endOfWeek(cursor, WEEK_OPTS)
  const days = eachDayOfInterval({ start, end })
  return <TimeGridView days={days} onPickSlot={onPickSlot} onPickEvent={onPickEvent} />
}
