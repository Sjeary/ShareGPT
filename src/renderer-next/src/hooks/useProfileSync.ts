import { useEffect } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useChatStore } from '@/store/useChatStore'

// 个人资料编辑回流: 监听主进程 onProfileUpdated, 把最新昵称/头像同步到各处。
// 移植自旧 renderer.js handleProfileUpdated(~5266) + main 注册(~5296):
//   - 仅当回传 username 与当前账号一致时更新 (避免串号)。
//   - 刷新 useAuthStore.profile (账户面板头像/昵称) 与 useChatStore.identity (聊天身份)。
//   - patchSection('collab', { last_avatar }) 持久化头像 (旧 saveSettings)。
// 由 AccountPanel 挂载 (一次), 避免改动 layout/Shell 文件。

interface ProfilePayload {
  profile?: { username?: string; displayName?: string; avatar?: string }
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function useProfileSync() {
  useEffect(() => {
    const off = api.onProfileUpdated((raw) => {
      const payload = (raw && typeof raw === 'object' ? raw : {}) as ProfilePayload
      const incoming = payload.profile ?? {}

      const currentUsername =
        useAuthStore.getState().profile?.username ||
        useChatStore.getState().identity.username ||
        ''
      const username = safeText(incoming.username) || currentUsername
      // 仅同步当前账号的资料 (旧 handleProfileUpdated: username === state.collab.username)。
      if (!username || username !== currentUsername) return

      const prevProfile = useAuthStore.getState().profile
      const displayName = safeText(incoming.displayName) || prevProfile?.displayName || username
      const avatar = safeText(incoming.avatar) || prevProfile?.avatar || ''

      useAuthStore.getState().setProfile({ username, displayName, avatar })
      useChatStore.getState().setIdentity({ displayName, avatar })
      void useAppStore.getState().patchSection('collab', { last_avatar: avatar })
    })
    return off
  }, [])
}
