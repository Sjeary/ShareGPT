import { useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/useAuth'
import { isStaleAttemptError } from '@/lib/latestAttempt'
import { describeUserError } from '@/lib/userFacingError'
import { useAppStore } from '@/store/useAppStore'

export type TeamLoginErrorField = 'server' | 'username' | 'password'

// 封装团队登录表单状态，供 WorkspaceEntryFlow 与 PersonalAccountView 复用。
export function useTeamLoginFormState() {
  const collab = useAppStore((s) => s.settings?.collab)
  const patchSection = useAppStore((s) => s.patchSection)
  const { login } = useAuth()

  const hasSeenWorkspaceIntro = Boolean(
    useAppStore.getState().settings?.ui?.workspace_entry_intro_done ||
    useAppStore.getState().settings?.ui?.onboarding_done,
  )

  const [serverUrl, setServerUrl] = useState(collab?.server_url ?? '')
  const [username, setUsername] = useState(collab?.last_username ?? '')
  const [rememberPassword, setRememberPassword] = useState(collab?.remember_password ?? false)
  const [password, setPassword] = useState(
    collab?.remember_password ? (collab?.saved_password ?? '') : '',
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [errorField, setErrorField] = useState<TeamLoginErrorField | null>(null)
  const [errorShakeKey, setErrorShakeKey] = useState(0)

  const serverRef = useRef<HTMLInputElement>(null)
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const loginUiBusyRef = useRef(false)

  function focusField(field: TeamLoginErrorField, select = false) {
    const ref = field === 'server' ? serverRef : field === 'username' ? usernameRef : passwordRef
    window.setTimeout(() => {
      ref.current?.focus()
      if (select) ref.current?.select()
    }, 0)
  }

  function triggerFieldError(message: string, field: TeamLoginErrorField) {
    setError(message)
    setErrorField(field)
    setErrorShakeKey((k) => k + 1)
    focusField(field)
  }

  async function submitLogin(e: FormEvent, blocked = false) {
    e.preventDefault()
    if (loginUiBusyRef.current || submitting || blocked) return

    const trimmedServer = serverUrl.trim()
    const trimmedUser = username.trim()
    if (!trimmedServer) return triggerFieldError('请填写服务地址', 'server')
    if (!trimmedUser) return triggerFieldError('请填写账号', 'username')
    if (!password) return triggerFieldError('请填写密码', 'password')

    setError('')
    setErrorField(null)
    loginUiBusyRef.current = true
    setSubmitting(true)
    try {
      if (!hasSeenWorkspaceIntro) {
        await patchSection('ui', { workspace_entry_intro_done: true }).catch(() => undefined)
      }
      const profile = await login({ serverUrl, username, password, rememberPassword })
      toast.success(`登录成功，欢迎 ${profile.displayName}`)
    } catch (err) {
      if (isStaleAttemptError(err)) return
      setError(err)
      setErrorShakeKey((k) => k + 1)
      const category = describeUserError(err).category
      const field =
        category === 'connection' ? 'server' : category === 'credentials' ? 'password' : null
      setErrorField(field)
      if (field) focusField(field, field === 'password')
    } finally {
      loginUiBusyRef.current = false
      setSubmitting(false)
    }
  }

  return {
    collab,
    hasSeenWorkspaceIntro,
    serverUrl,
    setServerUrl,
    username,
    setUsername,
    password,
    setPassword,
    rememberPassword,
    setRememberPassword,
    submitting,
    setSubmitting,
    error,
    setError,
    errorField,
    setErrorField,
    errorShakeKey,
    setErrorShakeKey,
    serverRef,
    usernameRef,
    passwordRef,
    loginUiBusyRef,
    submitLogin,
  }
}
