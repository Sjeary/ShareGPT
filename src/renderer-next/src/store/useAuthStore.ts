import { create } from 'zustand'

// 协作服务器登录态 (渲染层直连协作服务器, 非 IPC)。
// 与 useAppStore.authed 配合: useAppStore.authed 表示"是否已登录"的全局开关,
// 本切片保存 token / 用户资料等运行期会话数据 (不持久化到 settings.json)。

export interface AuthProfile {
  username: string
  displayName: string
  avatar: string
}

interface AuthState {
  token: string
  profile: AuthProfile | null
  // 运行期密码 (用于断线静默重登, 不写盘除非用户勾选记住密码)
  runtimePassword: string

  setSession: (session: { token: string; profile: AuthProfile; password: string }) => void
  clearSession: () => void
}

const EMPTY_PROFILE: AuthProfile | null = null

export const useAuthStore = create<AuthState>((set) => ({
  token: '',
  profile: EMPTY_PROFILE,
  runtimePassword: '',

  setSession: ({ token, profile, password }) =>
    set({ token, profile, runtimePassword: password }),

  clearSession: () => set({ token: '', profile: null, runtimePassword: '' }),
}))
