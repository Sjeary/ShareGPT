import limits from '../../../../collab_server2/chat_limits.json' with { type: 'json' }

export const MAX_CHAT_TEXT_LENGTH = limits.maxTextLength

export function assertChatTextLength(text: string): void {
  if (text.length > MAX_CHAT_TEXT_LENGTH) {
    throw new Error(
      `消息不能超过 ${MAX_CHAT_TEXT_LENGTH} 个字符，请缩短正文或作为文件发送。草稿已保留。`,
    )
  }
}
