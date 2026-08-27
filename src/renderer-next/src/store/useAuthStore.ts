import { create } from 'zustand'
import type { BootstrapUpdate } from '@/components/panels/account/bootstrap'
import type { AdvancedAiRoute, SenderSettings } from '@/types/settings'

// 协作服务器登录态 (渲染层直连协作服务器, 非 IPC)。
// 与 useAppStore.authed 配合: useAppStore.authed 表示"是否已登录"的全局开关,
// 本切片保存 token / 用户资料等运行期会话数据 (不持久化到 settings.json)。

export interface AuthProfile {
  username: string
  displayName: string
  avatar: string
  // 是否为管理员 (服务端 /api/login 的 profile 下发)。用于门控仅管理员可用的功能。
  isAdmin?: boolean
  // 是否获管理员授权使用高级 AI 多环境；管理员始终视为已授权。
  advancedAiAllowed?: boolean
  // 权威 bootstrap 已成功读取后才允许使用线路，避免旧账号线路残留。
  routeAuthorizationVerified?: boolean
  allowedProxyRouteIds?: string[]
  // 主进程完成当前 token + Principal 鉴权后返回的无密钥运行时线路描述。
  authorizedAiRoutes?: AdvancedAiRoute[]
  // 是否被禁止使用协作聊天 (管理员设置): 隐藏聊天入口、不收消息、不弹通知。
  chatDisabled?: boolean
}

export interface RuntimeSenderConfig {
  principalId: string
  sender: Partial<SenderSettings>
}

interface AuthState {
  token: string
  profile: AuthProfile | null
  // 运行期密码 (用于断线静默重登, 不写盘除非用户勾选记住密码)
  runtimePassword: string
  // 登录后 /api/client/bootstrap 下发的最新版本信息 (供更新 UI 读取)。
  // null = 尚未拉取过; 旧 state.app.updateInfo (~2817)。
  updateInfo: BootstrapUpdate | null
  // 当前 Principal 的服务端 sender 配置。只存在内存中，绝不写入 settings.json。
  runtimeSender: RuntimeSenderConfig | null

  setSession: (session: { token: string; profile: AuthProfile; password: string }) => void
  setUpdateInfo: (update: BootstrapUpdate | null) => void
  setRuntimeSender: (config: RuntimeSenderConfig | null) => void
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
  runtimeSender: null,

  setSession: ({ token, profile, password }) => set({ token, profile, runtimePassword: password }),

  setUpdateInfo: (update) => set({ updateInfo: update }),

  setRuntimeSender: (runtimeSender) => set({ runtimeSender }),

  setProfile: (profile) => set({ profile }),

  clearSession: () =>
    set({ token: '', profile: null, runtimePassword: '', updateInfo: null, runtimeSender: null }),
}))
