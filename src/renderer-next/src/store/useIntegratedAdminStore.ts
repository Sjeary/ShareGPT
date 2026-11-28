import { create } from 'zustand'
import { adminCapabilities, createAdminApi, normalizeServerUrl } from '../lib/adminApi.ts'
import type { IntegratedAdminApi } from '../lib/adminApi.ts'
import { AuthExpiredError } from '../types/admin.ts'
import type {
  AdminAirport,
  AdminExtras,
  AdminInvite,
  AdminOverview,
  AdminReleases,
  AdminTab,
  AdminTranslationProfile,
  AdminUser,
  AiUsageFilters,
  AiUsageReport,
  Bootstrap,
  CreateInviteInput,
  CreateUserInput,
  FeedbackItem,
  IntegratedAdminSession,
  ProxyMissingItem,
  ProxyRoute,
  ProxyRouteHealth,
  ReleaseUploadInput,
  TranslationProfileCatalog,
  TranslationUsageFilters,
  TranslationUsageReport,
  UpdateUserInput,
} from '../types/admin.ts'

export type AdminResource =
  | 'users'
  | 'invites'
  | 'bootstrap'
  | 'proxyRoutes'
  | 'proxyRouteHealth'
  | 'aiUsage'
  | 'translationCatalog'
  | 'translationUsage'
  | 'feedback'
  | 'proxyMissing'
  | 'releases'
  | 'airport'

interface AdminData {
  session: IntegratedAdminSession | null
  activeTab: AdminTab
  users: AdminUser[]
  overview: AdminOverview | null
  invites: AdminInvite[]
  bootstrap: Bootstrap | null
  proxyRoutes: ProxyRoute[]
  proxyRouteHealth: ProxyRouteHealth[]
  aiUsage: AiUsageReport | null
  translationCatalog: TranslationProfileCatalog | null
  translationUsage: TranslationUsageReport | null
  feedback: FeedbackItem[]
  proxyMissing: ProxyMissingItem[]
  releases: AdminReleases | null
  airport: AdminAirport | null
  loading: Partial<Record<AdminResource, boolean>>
  loaded: Partial<Record<AdminResource, boolean>>
  errors: Partial<Record<AdminResource, string>>
}

export interface IntegratedAdminState extends AdminData {
  capabilities: typeof adminCapabilities
  bindSession: (session: IntegratedAdminSession | null) => void
  clear: () => void
  setActiveTab: (tab: AdminTab) => void
  loadTab: (tab: AdminTab) => Promise<void>
  loadOverview: () => Promise<AdminUser[] | undefined>
  loadUsers: () => Promise<AdminUser[] | undefined>
  createUser: (input: CreateUserInput) => Promise<AdminUser | undefined>
  updateUser: (username: string, input: UpdateUserInput) => Promise<AdminUser | undefined>
  deleteUser: (username: string) => Promise<unknown>
  resetPassword: (username: string, password: string) => Promise<AdminUser | undefined>
  loadInvites: () => Promise<AdminInvite[] | undefined>
  createInvite: (input: CreateInviteInput) => Promise<AdminInvite | undefined>
  revokeInvite: (id: string) => Promise<unknown>
  loadBootstrap: () => Promise<Bootstrap | undefined>
  saveBootstrap: (input: Bootstrap) => Promise<Bootstrap | undefined>
  saveExtras: (extra: AdminExtras) => Promise<Bootstrap | undefined>
  loadProxyRoutes: () => Promise<ProxyRoute[] | undefined>
  saveProxyRoutes: (routes: ProxyRoute[]) => Promise<ProxyRoute[] | undefined>
  checkProxyRouteHealth: () => Promise<ProxyRouteHealth[] | undefined>
  loadAiUsage: (filters?: AiUsageFilters) => Promise<AiUsageReport | undefined>
  loadTranslationProfiles: () => Promise<TranslationProfileCatalog | undefined>
  saveTranslationProfiles: (
    defaultProfileId: string,
    profiles: AdminTranslationProfile[],
  ) => Promise<TranslationProfileCatalog | undefined>
  saveTranslationProfile: (
    profile: AdminTranslationProfile,
    makeDefault?: boolean,
  ) => Promise<TranslationProfileCatalog | undefined>
  deleteTranslationProfile: (id: string) => Promise<TranslationProfileCatalog | undefined>
  loadTranslationUsage: (
    filters?: TranslationUsageFilters,
  ) => Promise<TranslationUsageReport | undefined>
  loadFeedback: () => Promise<FeedbackItem[] | undefined>
  deleteFeedback: (id: string) => Promise<unknown>
  loadProxyMissing: () => Promise<ProxyMissingItem[] | undefined>
  clearProxyMissing: () => Promise<unknown>
  loadReleases: () => Promise<AdminReleases | undefined>
  deleteRelease: (version: string) => Promise<unknown>
  uploadRelease: (input: ReleaseUploadInput) => Promise<Bootstrap | undefined>
  loadAirport: () => Promise<AdminAirport | undefined>
  saveAirport: (input: AdminAirport) => Promise<AdminAirport | undefined>
}

const emptyData = (): AdminData => ({
  session: null,
  activeTab: 'overview',
  users: [],
  overview: null,
  invites: [],
  bootstrap: null,
  proxyRoutes: [],
  proxyRouteHealth: [],
  aiUsage: null,
  translationCatalog: null,
  translationUsage: null,
  feedback: [],
  proxyMissing: [],
  releases: null,
  airport: null,
  loading: {},
  loaded: {},
  errors: {},
})

// No DOM, toasts, persistence, timers or login-time data fetching. The owner must
// bind the desktop auth source for the application lifetime (not just the panel).
export function createIntegratedAdminStore(apiFactory = createAdminApi) {
  return create<IntegratedAdminState>((set, get) => {
    let generation = 0
    let sequence = 0
    const latest = new Map<AdminResource, number>()
    const controllers = new Set<AbortController>()
    const reads = new Map<AdminResource, { query: string; promise: Promise<unknown> }>()
    let mutationTail: Promise<unknown> = Promise.resolve()
    let queuedWrites = 0

    const clear = () => {
      generation++
      for (const controller of controllers) controller.abort()
      controllers.clear()
      latest.clear()
      reads.clear()
      mutationTail = Promise.resolve()
      queuedWrites = 0
      set(emptyData())
    }

    function run<T>(
      key: AdminResource,
      action: (api: IntegratedAdminApi) => Promise<T>,
      commit: (value: T) => Partial<AdminData> = () => ({}),
      query = '',
    ): Promise<T | undefined> {
      const existing = reads.get(key)
      if (existing?.query === query) return existing.promise as Promise<T | undefined>
      const pending = runRequest(key, action, commit)
      const entry = { query, promise: pending }
      reads.set(key, entry)
      void pending
        .finally(() => {
          if (reads.get(key) === entry) reads.delete(key)
        })
        .catch(() => undefined)
      return pending
    }

    async function runRequest<T>(
      key: AdminResource,
      action: (api: IntegratedAdminApi) => Promise<T>,
      commit: (value: T) => Partial<AdminData> = () => ({}),
      writing = false,
    ): Promise<T | undefined> {
      const started = generation
      // A refresh during a save must observe its committed result, rather than
      // superseding the save with a pre-write snapshot.
      if (!writing && queuedWrites) {
        await mutationTail
        if (started !== generation) return undefined
      }
      const session = get().session
      if (!session || session.isAdmin !== true) throw new AuthExpiredError('需要管理员会话')
      const id = ++sequence
      latest.set(key, id)
      const controller = new AbortController()
      controllers.add(controller)
      const current = () => started === generation
      const newest = () => current() && latest.get(key) === id
      set((state) => ({
        loading: { ...state.loading, [key]: true },
        errors: { ...state.errors, [key]: undefined },
      }))
      try {
        const result = await action(apiFactory(session.serverUrl, session.token, controller.signal))
        if (!newest()) return undefined
        set((state) => ({ ...commit(result), loaded: { ...state.loaded, [key]: true } }))
        return result
      } catch (error) {
        if (!current()) return undefined
        if (error instanceof AuthExpiredError) {
          clear()
          throw error
        }
        if (!newest()) return undefined
        set((state) => ({
          errors: {
            ...state.errors,
            [key]: error instanceof Error ? error.message : String(error),
          },
        }))
        throw error
      } finally {
        controllers.delete(controller)
        if (newest()) set((state) => ({ loading: { ...state.loading, [key]: false } }))
      }
    }

    // Serial writes avoid lost read/modify/write updates to bootstrap/catalogs.
    // A queued write captures its original account before it waits.
    function mutate<T>(
      key: AdminResource,
      action: (api: IntegratedAdminApi) => Promise<T>,
      commit?: (value: T) => Partial<AdminData>,
    ): Promise<T | undefined> {
      const started = generation
      if (!get().session) return Promise.reject(new AuthExpiredError('需要管理员会话'))
      // A read requested after a write must wait for that write, not join an
      // earlier request whose response may contain the pre-write snapshot.
      reads.clear()
      queuedWrites++
      const pending = mutationTail
        .then(() => (started === generation ? runRequest(key, action, commit, true) : undefined))
        .finally(() => {
          if (started === generation) queuedWrites--
        })
      mutationTail = pending.catch(() => undefined)
      return pending
    }

    const usersPatch = (users: AdminUser[]): Partial<AdminData> => ({
      users,
      overview: {
        total: users.length,
        online: users.filter((u) => u.online).length,
        admins: users.filter((u) => u.isAdmin).length,
        disabled: users.filter((u) => u.disabled).length,
        advancedAi: users.filter((u) => u.isAdmin || u.advancedAiAllowed).length,
      },
    })
    const bootstrapPatch = (bootstrap: Bootstrap): Partial<AdminData> => ({
      bootstrap,
      releases: bootstrap.update,
    })
    const refreshUsers = (action: (api: IntegratedAdminApi) => Promise<AdminUser>) =>
      mutate(
        'users',
        async (api) => {
          const user = await action(api)
          return { user, users: await api.loadUsers() }
        },
        (r) => usersPatch(r.users),
      ).then((r) => r?.user)

    return {
      ...emptyData(),
      capabilities: adminCapabilities,
      clear,
      bindSession: (input) => {
        if (
          !input ||
          input.isAdmin !== true ||
          !input.token ||
          !input.username ||
          !input.serverUrl
        ) {
          clear()
          return
        }
        let serverUrl: string
        try {
          serverUrl = normalizeServerUrl(input.serverUrl)
        } catch (error) {
          clear()
          throw error
        }
        const previous = get().session
        if (
          previous &&
          previous.serverUrl === serverUrl &&
          previous.token === input.token &&
          previous.username === input.username &&
          previous.isAdmin === input.isAdmin
        )
          return
        clear()
        set({ session: { ...input, serverUrl } })
      },
      setActiveTab: (activeTab) => set({ activeTab }),
      loadTab: async (tab) => {
        get().setActiveTab(tab)
        const s = get()
        const loaders: Record<AdminTab, () => Promise<unknown>> = {
          overview: s.loadOverview,
          users: s.loadUsers,
          invites: s.loadInvites,
          bootstrap: s.loadBootstrap,
          extras: s.loadBootstrap,
          releases: s.loadReleases,
          feedback: s.loadFeedback,
          'proxy-missing': s.loadProxyMissing,
          'ai-usage': s.loadAiUsage,
          airport: async () => {
            await Promise.all([s.loadProxyRoutes(), s.checkProxyRouteHealth(), s.loadAirport()])
          },
          translation: s.loadTranslationProfiles,
        }
        await loaders[tab]()
      },
      loadOverview: () => get().loadUsers(),
      loadUsers: () => run('users', (api) => api.loadUsers(), usersPatch),
      createUser: (input) => refreshUsers((api) => api.createUser(input)),
      updateUser: (username, input) => refreshUsers((api) => api.updateUser(username, input)),
      resetPassword: (username, password) =>
        refreshUsers((api) => api.resetPassword(username, password)),
      deleteUser: (username) => mutate('users', (api) => api.deleteUser(username)),
      loadInvites: () =>
        run(
          'invites',
          (api) => api.loadInvites(),
          (invites) => ({ invites }),
        ),
      createInvite: (input) =>
        mutate(
          'invites',
          async (api) => {
            const invite = await api.createInvite(input)
            return { invite, invites: await api.loadInvites() }
          },
          (r) => ({ invites: r.invites }),
        ).then((r) => r?.invite),
      revokeInvite: (id) =>
        mutate(
          'invites',
          async (api) => {
            await api.revokeInvite(id)
            return api.loadInvites()
          },
          (invites) => ({ invites }),
        ),
      loadBootstrap: () => run('bootstrap', (api) => api.loadBootstrap(), bootstrapPatch),
      saveBootstrap: (input) =>
        mutate('bootstrap', (api) => api.saveBootstrap(input), bootstrapPatch),
      saveExtras: (extra) =>
        mutate(
          'bootstrap',
          async (api) => api.saveBootstrap({ ...(await api.loadBootstrap()), extra }),
          bootstrapPatch,
        ),
      loadProxyRoutes: () =>
        run(
          'proxyRoutes',
          async (api) => (await api.loadProxyRoutes()).routes,
          (proxyRoutes) => ({ proxyRoutes }),
        ),
      saveProxyRoutes: (routes) =>
        mutate(
          'proxyRoutes',
          async (api) => (await api.saveProxyRoutes(routes)).routes,
          (proxyRoutes) => ({ proxyRoutes }),
        ),
      checkProxyRouteHealth: () =>
        run(
          'proxyRouteHealth',
          (api) => api.checkProxyRouteHealth(),
          (proxyRouteHealth) => ({ proxyRouteHealth }),
        ),
      loadAiUsage: (filters) =>
        run(
          'aiUsage',
          (api) => api.loadAiUsage(filters),
          (aiUsage) => ({ aiUsage }),
          JSON.stringify([filters?.service || 'gpt', filters?.from || '', filters?.to || '']),
        ),
      loadTranslationProfiles: () =>
        run(
          'translationCatalog',
          (api) => api.loadTranslationProfiles(),
          (translationCatalog) => ({ translationCatalog }),
        ),
      saveTranslationProfiles: (id, profiles) =>
        mutate(
          'translationCatalog',
          (api) => api.saveTranslationProfiles(id, profiles),
          (translationCatalog) => ({ translationCatalog }),
        ),
      saveTranslationProfile: (profile, makeDefault = false) =>
        mutate(
          'translationCatalog',
          async (api) => {
            const catalog = await api.loadTranslationProfiles()
            const profiles = catalog.profiles.filter((p) => p.id !== profile.id)
            profiles.push(profile)
            return api.saveTranslationProfiles(
              makeDefault ? profile.id : catalog.defaultProfileId,
              profiles,
            )
          },
          (translationCatalog) => ({ translationCatalog }),
        ),
      deleteTranslationProfile: (id) =>
        mutate(
          'translationCatalog',
          async (api) => {
            const catalog = await api.loadTranslationProfiles()
            return api.saveTranslationProfiles(
              catalog.defaultProfileId === id ? '' : catalog.defaultProfileId,
              catalog.profiles.filter((p) => p.id !== id),
            )
          },
          (translationCatalog) => ({ translationCatalog }),
        ),
      loadTranslationUsage: (filters) =>
        run(
          'translationUsage',
          (api) => api.loadTranslationUsage(filters),
          (translationUsage) => ({ translationUsage }),
          JSON.stringify([
            filters?.from || '',
            filters?.to || '',
            filters?.username || '',
            filters?.profileId || '',
          ]),
        ),
      loadFeedback: () =>
        run(
          'feedback',
          (api) => api.loadFeedback(),
          (feedback) => ({ feedback }),
        ),
      deleteFeedback: (id) => mutate('feedback', (api) => api.deleteFeedback(id)),
      loadProxyMissing: () =>
        run(
          'proxyMissing',
          (api) => api.loadProxyMissing(),
          (proxyMissing) => ({ proxyMissing }),
        ),
      clearProxyMissing: () => mutate('proxyMissing', (api) => api.clearProxyMissing()),
      // Effective release metadata is owned by bootstrap, including its request
      // generation/loading state. Do not race two caches of the same endpoint.
      loadReleases: () =>
        get()
          .loadBootstrap()
          .then((bootstrap) => bootstrap?.update),
      deleteRelease: (version) => mutate('releases', (api) => api.deleteRelease(version)),
      uploadRelease: (input) =>
        mutate(
          'bootstrap',
          async (api) => (await api.uploadRelease(input)).bootstrap,
          bootstrapPatch,
        ),
      loadAirport: () =>
        run(
          'airport',
          (api) => api.loadAirport(),
          (airport) => ({ airport }),
        ),
      saveAirport: (input) =>
        mutate(
          'airport',
          (api) => api.saveAirport(input),
          (airport) => ({ airport }),
        ),
    }
  })
}

export const useIntegratedAdminStore = createIntegratedAdminStore()

// Install once at the app/auth owner. getSession must read the *current* endpoint,
// token, server-confirmed username and isAdmin; personal/offline mode returns null.
// subscribe must cover BOTH auth and endpoint/workspace-mode changes synchronously.
export function connectIntegratedAdminSession(
  source: {
    getSession: () => IntegratedAdminSession | null
    subscribe: (listener: () => void) => () => void
  },
  store = useIntegratedAdminStore,
): () => void {
  let initialized = false
  let previous: IntegratedAdminSession | null = null
  const sync = () => {
    const input = source.getSession()
    let next: IntegratedAdminSession | null = null
    if (input?.isAdmin === true && input.token && input.username && input.serverUrl) {
      try {
        next = { ...input, serverUrl: normalizeServerUrl(input.serverUrl) }
      } catch (error) {
        store.getState().clear()
        previous = null
        initialized = false
        throw error
      }
    }
    if (
      initialized &&
      previous?.serverUrl === next?.serverUrl &&
      previous?.token === next?.token &&
      previous?.username === next?.username &&
      previous?.isAdmin === next?.isAdmin
    )
      return
    // Track the desktop source, not the derived management credential. Legacy
    // servers may exchange it; navigation/status/profile display updates must
    // neither replace that credential nor resurrect a rejected session.
    store.getState().bindSession(next)
    previous = next
    initialized = true
  }
  const unsubscribe = source.subscribe(sync)
  sync()
  return () => {
    unsubscribe()
    store.getState().clear()
  }
}
