import { create } from 'zustand'
import type { BootstrapUpdate } from '@/components/panels/account/bootstrap'

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
  // 登录后 /api/client/bootstrap 下发的最新版本信息 (供更新 UI 读取)。
  // null = 尚未拉取过; 旧 state.app.updateInfo (~2817)。
  updateInfo: BootstrapUpdate | null

  setSession: (session: { token: string; profile: AuthProfile; password: string }) => void
  setUpdateInfo: (update: BootstrapUpdate | null) => void
  // 资料回流: 仅更新身份资料 (个人资料编辑器回调) (旧 handleProfileUpdated ~5266)。
  setProfile: (profile: AuthProfile) => void
  clearSession: () => void
}

const EMPTY_PROFILE: AuthProfile | null = null

export const useAuthStore = create<AuthState>((set) => ({
  token: '',
  profile: EMPTY_PROFILE,
  runtimePassword: '',
  updateInfo: null,

  setSession: ({ token, profile, password }) =>
    set({ token, profile, runtimePassword: password }),

  setUpdateInfo: (update) => set({ updateInfo: update }),

  setProfile: (profile) => set({ profile }),

  clearSession: () => set({ token: '', profile: null, runtimePassword: '', updateInfo: null }),
}))
