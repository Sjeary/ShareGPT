import { toast } from 'sonner'
import { describeUserError } from './userFacingError'

export function showErrorToast(error: unknown, context: string) {
  const notice = describeUserError(error, context)
  toast.error(`${context}：${notice.title}`, {
    description: [notice.description, notice.suggestion].filter(Boolean).join(' '),
    duration: 10000,
    action: {
      label: '复制详情',
      onClick: () => {
        void navigator.clipboard
          .writeText(notice.details)
          .then(() => toast.success('技术详情已复制'))
          .catch(() => toast.error('复制失败，请重试'))
      },
    },
  })
}
