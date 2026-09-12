import { userDataApiFor } from './api'
import {
  settingsPrincipalRuntime,
  type SettingsPrincipalSnapshot,
} from './settingsPrincipalRuntime'
import { createPrincipalDebouncedSave } from './principalDebouncedSave'
import { coalesceInFlight } from './inFlightRequest'
import { useChatStore } from '@/store/useChatStore'
import { hydrateConversations, serializeConversations } from '@/components/panels/chat/normalize'
import { userDataTransitionState } from './userDataTransitionState'

let owner: SettingsPrincipalSnapshot | null = null
let loaded = false
const loads = new Map<string, Promise<void>>()
const save = createPrincipalDebouncedSave<ReturnType<typeof serializeConversations>>(
  (payload, snapshot) => userDataApiFor(snapshot).saveChatHistory(payload),
)
const current = () =>
  owner &&
  owner.principalId === settingsPrincipalRuntime.current().principalId &&
  owner.generation === settingsPrincipalRuntime.current().generation

export const chatPersistence = {
  isLoaded: () => loaded,
  init() {
    const snapshot = settingsPrincipalRuntime.snapshot()
    if (loaded && current()) return Promise.resolve()
    return coalesceInFlight(loads, JSON.stringify(snapshot), async () => {
      const data = await userDataApiFor(snapshot).loadChatHistory()
      const conversations = hydrateConversations(data)
      // A URL bucket may mix accounts. Keep its file untouched until explicit legacy import.
      if (Object.keys(conversations).some((key) => key.includes('\u0000'))) {
        throw new Error('旧聊天资料需要确认归属，原文件已保留')
      }
      const live = useChatStore.getState().messagesByConversation
      useChatStore.getState().hydrate(conversations)
      useChatStore.getState().mergeMessages(Object.values(live).flat())
      owner = snapshot
      loaded = true
    })
  },
  schedule() {
    if (!loaded || !current() || userDataTransitionState.isSuspended()) return
    save.schedule(serializeConversations(useChatStore.getState().messagesByConversation), owner!)
  },
  flushPending() {
    if (
      !loaded &&
      Object.values(useChatStore.getState().messagesByConversation).some(
        (messages) => messages.length,
      )
    ) {
      return Promise.reject(new Error('聊天资料尚未完整读取，请恢复本机资料后再切换'))
    }
    if (loaded && current())
      save.schedule(serializeConversations(useChatStore.getState().messagesByConversation), owner!)
    return save.flushPending()
  },
  resetForPrincipal() {
    owner = null
    loaded = false
    loads.clear()
    save.cancel()
    useChatStore.getState().clearGroupCaches()
  },
}
