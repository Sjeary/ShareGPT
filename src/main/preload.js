const { contextBridge, ipcRenderer } = require("electron");

async function dataInvoke(channel, payload, expected) {
  const snapshot = expected || (await ipcRenderer.invoke("settings:principal-context"));
  return ipcRenderer.invoke(channel, payload, snapshot);
}

contextBridge.exposeInMainWorld("api", {
  platform: process.platform,
  setThemeSource: (source) => ipcRenderer.invoke("app:set-theme-source", source),
  loadSettings: (payload) => ipcRenderer.invoke("settings:load", payload),
  activateSettingsPrincipal: (payload) =>
    ipcRenderer.invoke("settings:principal-activate", payload),
  clearSettingsPrincipal: (payload) => ipcRenderer.invoke("settings:principal-clear", payload),
  getSettingsPrincipal: () => ipcRenderer.invoke("settings:principal-context"),
  verifySettingsPrincipalLogin: (payload) =>
    ipcRenderer.invoke("settings:principal-verify", payload),
  saveSettings: (payload) => ipcRenderer.invoke("settings:save", payload),
  patchSettings: (payload) => ipcRenderer.invoke("settings:patch", payload),
  operateSettings: (payload) => ipcRenderer.invoke("settings:operate", payload),
  importSettings: () => ipcRenderer.invoke("settings:import"),
  loadChatHistory: (snapshot) => dataInvoke("chat-history:load", undefined, snapshot),
  saveChatHistory: (payload, snapshot) => dataInvoke("chat-history:save", payload, snapshot),
  loadCalendar: (snapshot) => dataInvoke("calendar:load", undefined, snapshot),
  saveCalendar: (payload, snapshot) => dataInvoke("calendar:save", payload, snapshot),
  loadTasks: (snapshot) => dataInvoke("tasks:load", undefined, snapshot),
  saveTasks: (payload, snapshot) => dataInvoke("tasks:save", payload, snapshot),
  loadFocus: (snapshot) => dataInvoke("focus:load", undefined, snapshot),
  saveFocus: (payload, snapshot) => dataInvoke("focus:save", payload, snapshot),
  // 知识库 vault (笔记文件 IO)。
  vault: {
    start: (snapshot) => dataInvoke("vault:start", undefined, snapshot),
    getRoot: (snapshot) => dataInvoke("vault:get-root", undefined, snapshot),
    setRoot: (absPath, snapshot) => dataInvoke("vault:set-root", absPath, snapshot),
    pickFolder: (snapshot) => dataInvoke("vault:pick-folder", undefined, snapshot),
    list: (snapshot) => dataInvoke("vault:list", undefined, snapshot),
    readAll: (snapshot) => dataInvoke("vault:read-all", undefined, snapshot),
    read: (p, snapshot) => dataInvoke("vault:read", p, snapshot),
    readBinary: (p, snapshot) => dataInvoke("vault:read-binary", p, snapshot),
    write: (p, content, snapshot) => dataInvoke("vault:write", { path: p, content }, snapshot),
    create: (p, content, snapshot) => dataInvoke("vault:create", { path: p, content }, snapshot),
    rename: (from, to, snapshot) => dataInvoke("vault:rename", { from, to }, snapshot),
    remove: (p, snapshot) => dataInvoke("vault:remove", p, snapshot),
    importFrom: (src, snapshot) => dataInvoke("vault:import", src, snapshot),
  },
  onVaultChanged: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("vault:changed", listener);
    return () => ipcRenderer.removeListener("vault:changed", listener);
  },
  // 知识库 AI (Responses 流式)。
  notesAi: {
    complete: (req) => ipcRenderer.invoke("notes-ai:complete", req),
    cancel: (id) => ipcRenderer.invoke("notes-ai:cancel", id),
    invalidatePrincipal: (principalId) =>
      ipcRenderer.invoke("notes-ai:invalidate-principal", principalId),
  },
  onNotesAiEvent: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("notes-ai:event", listener);
    return () => ipcRenderer.removeListener("notes-ai:event", listener);
  },
  translateText: (payload) => ipcRenderer.invoke("translation:translate", payload),
  cancelTranslation: (requestId) => ipcRenderer.invoke("translation:cancel", { requestId }),
  captureAiPageText: (kind, tabId, environmentId) =>
    ipcRenderer.invoke("translation:capture-page", { kind, tabId, environmentId }),
  captureAiSelectionText: (kind, tabId, environmentId) =>
    ipcRenderer.invoke("translation:capture-selection", { kind, tabId, environmentId }),
  getAiComposerTarget: (payload) => ipcRenderer.invoke("translation:composer-target", payload),
  writeAiComposer: (payload) => ipcRenderer.invoke("translation:write-composer", payload),
  syncAiComposerGuard: () => ipcRenderer.invoke("translation:composer-guard-sync"),
  resolveAiComposerConfirmation: (payload) =>
    ipcRenderer.invoke("translation:composer-confirmation-resolve", payload),
  exportUserData: (snapshot) => dataInvoke("user-data:export", undefined, snapshot),
  importUserData: (snapshot) => dataInvoke("user-data:import", undefined, snapshot),
  inspectLegacyUserData: (snapshot) => dataInvoke("user-data:legacy-list", undefined, snapshot),
  importLegacyUserData: (payload, snapshot) =>
    dataInvoke("user-data:legacy-import", payload, snapshot),
  readClipboardAttachment: () => ipcRenderer.invoke("clipboard:read-attachment"),

  getStatus: () => ipcRenderer.invoke("service:status"),
  getPaths: () => ipcRenderer.invoke("app:paths"),
  getAppMeta: () => ipcRenderer.invoke("app:meta"),
  getDeviceInfo: () => ipcRenderer.invoke("app:device-info"),
  getMode: () => ipcRenderer.invoke("app:mode"),
  checkAppUpdate: () => ipcRenderer.invoke("app:update-check"),
  isUpdateSupported: () => ipcRenderer.invoke("app:update-supported"),
  installAppUpdate: (payload) => ipcRenderer.invoke("app:update-install", payload),
  downloadAppUpdate: (payload) => ipcRenderer.invoke("app:update-download", payload),
  openAppUpdate: (payload) => ipcRenderer.invoke("app:update-open", payload),
  showSystemNotification: (payload) => ipcRenderer.invoke("notifications:show", payload),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  // AI 标签 (GPT / Gemini 通用, 传 kind)。
  listAiViews: (kind) => ipcRenderer.invoke("ai-tabs:list", { kind }),
  createAiView: (kind, payload) =>
    ipcRenderer.invoke("ai-tabs:create", { ...(payload || {}), kind }),
  switchAiView: (kind, payload) =>
    ipcRenderer.invoke("ai-tabs:switch", { ...(payload || {}), kind }),
  closeAiView: (kind, payload) => ipcRenderer.invoke("ai-tabs:close", { ...(payload || {}), kind }),
  setActiveAiKind: (kind) => ipcRenderer.invoke("ai:set-active-kind", { kind }),
  ensureAiWorkspace: (payload) => ipcRenderer.invoke("ai:ensure", payload),
  activateAiEnvironment: (payload) => ipcRenderer.invoke("ai:environment-activate", payload),
  deleteAiEnvironment: (payload) => ipcRenderer.invoke("ai:environment-delete", payload),
  listAiEnvironmentCleanup: (payload) => ipcRenderer.invoke("ai:environment-cleanup-list", payload),
  retryAiEnvironmentCleanup: (payload) =>
    ipcRenderer.invoke("ai:environment-cleanup-retry", payload),
  checkAiEnvironmentEgress: (payload) => ipcRenderer.invoke("ai:environment-egress-check", payload),
  syncAiViewHost: (payload) => ipcRenderer.invoke("ai:sync-host", payload),
  navigateAiWorkspace: (payload) => ipcRenderer.invoke("ai:navigate", payload),
  checkAiProxy: (kind, tabId) => ipcRenderer.invoke("ai:proxy-check", { kind, tabId }),
  clearAiBrowserData: (kind, confirmation) =>
    ipcRenderer.invoke("ai:data-clear", { kind, ...(confirmation || {}) }),
  rebuildAiBrowserProfile: (kind, confirmation) =>
    ipcRenderer.invoke("ai:profile-rebuild", { kind, ...(confirmation || {}) }),
  captureBrowserFingerprint: (kind, tabId) =>
    ipcRenderer.invoke("browser-privacy:capture", { kind, tabId }),
  applyBrowserPrivacy: () => ipcRenderer.invoke("browser-privacy:apply"),
  detectProxyEnvironment: () => ipcRenderer.invoke("browser-privacy:detect-proxy-environment"),
  openProfileEditor: (payload) => ipcRenderer.invoke("profile:open", payload),
  emitProfileUpdated: (payload) => ipcRenderer.send("profile:updated", payload),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  isWindowFullScreen: () => ipcRenderer.invoke("window:is-fullscreen"),
  toggleWindowFullScreen: (value) => ipcRenderer.invoke("window:toggle-fullscreen", { value }),

  startSender: (settings) => ipcRenderer.invoke("sender:start", settings),
  stopSender: () => ipcRenderer.invoke("sender:stop"),

  startReceiver: (settings) => ipcRenderer.invoke("receiver:start", settings),
  stopReceiver: () => ipcRenderer.invoke("receiver:stop"),

  onLog: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("log:line", listener);
    return () => ipcRenderer.removeListener("log:line", listener);
  },

  onStatus: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("service:status", listener);
    return () => ipcRenderer.removeListener("service:status", listener);
  },

  onProfileUpdated: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("profile:updated", listener);
    return () => ipcRenderer.removeListener("profile:updated", listener);
  },

  onAiEvent: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("ai:event", listener);
    return () => ipcRenderer.removeListener("ai:event", listener);
  },

  onAppEvent: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("app:event", listener);
    return () => ipcRenderer.removeListener("app:event", listener);
  },

  onAppUpdateProgress: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("app:update-progress", listener);
    return () => ipcRenderer.removeListener("app:update-progress", listener);
  },
});
