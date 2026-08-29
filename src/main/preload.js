const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  platform: process.platform,
  setThemeSource: (source) => ipcRenderer.invoke("app:set-theme-source", source),
  loadSettings: (payload) => ipcRenderer.invoke("settings:load", payload),
  activateSettingsPrincipal: (payload) =>
    ipcRenderer.invoke("settings:principal-activate", payload),
  clearSettingsPrincipal: () => ipcRenderer.invoke("settings:principal-clear"),
  getSettingsPrincipal: () => ipcRenderer.invoke("settings:principal-context"),
  saveSettings: (payload) => ipcRenderer.invoke("settings:save", payload),
  patchSettings: (payload) => ipcRenderer.invoke("settings:patch", payload),
  operateSettings: (payload) => ipcRenderer.invoke("settings:operate", payload),
  importSettings: (payload) => ipcRenderer.invoke("settings:import", payload),
  loadChatHistory: () => ipcRenderer.invoke("chat-history:load"),
  saveChatHistory: (payload) => ipcRenderer.invoke("chat-history:save", payload),
  loadCalendar: () => ipcRenderer.invoke("calendar:load"),
  saveCalendar: (payload) => ipcRenderer.invoke("calendar:save", payload),
  loadTasks: () => ipcRenderer.invoke("tasks:load"),
  saveTasks: (payload) => ipcRenderer.invoke("tasks:save", payload),
  loadFocus: () => ipcRenderer.invoke("focus:load"),
  saveFocus: (payload) => ipcRenderer.invoke("focus:save", payload),
  // 知识库 vault (笔记文件 IO)。
  vault: {
    start: () => ipcRenderer.invoke("vault:start"),
    getRoot: () => ipcRenderer.invoke("vault:get-root"),
    chooseRoot: () => ipcRenderer.invoke("vault:choose-root"),
    chooseImport: () => ipcRenderer.invoke("vault:choose-import"),
    list: () => ipcRenderer.invoke("vault:list"),
    readAll: () => ipcRenderer.invoke("vault:read-all"),
    read: (p) => ipcRenderer.invoke("vault:read", p),
    readBinary: (p) => ipcRenderer.invoke("vault:read-binary", p),
    write: (p, content) => ipcRenderer.invoke("vault:write", { path: p, content }),
    create: (p, content) => ipcRenderer.invoke("vault:create", { path: p, content }),
    rename: (from, to) => ipcRenderer.invoke("vault:rename", { from, to }),
    remove: (p) => ipcRenderer.invoke("vault:remove", p),
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
  cancelTranslation: (requestId) => ipcRenderer.invoke("translation:cancel", requestId),
  captureAiPageText: (kind, tabId, context) =>
    ipcRenderer.invoke("translation:capture-page", { ...(context || {}), kind, tabId }),
  writeAiComposer: (payload) => ipcRenderer.invoke("translation:write-composer", payload),
  resolveAiComposerSend: (payload) =>
    ipcRenderer.invoke("translation:resolve-composer-send", payload),
  setAiComposerEligibility: (payload) => ipcRenderer.invoke("ai:set-composer-eligibility", payload),
  exportUserData: (payload) => ipcRenderer.invoke("user-data:export", payload),
  importUserData: (payload) => ipcRenderer.invoke("user-data:import", payload),
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
  listAiViews: (payload) => ipcRenderer.invoke("ai-tabs:list", payload),
  createAiView: (kind, payload) =>
    ipcRenderer.invoke("ai-tabs:create", { ...(payload || {}), kind }),
  switchAiView: (kind, payload) =>
    ipcRenderer.invoke("ai-tabs:switch", { ...(payload || {}), kind }),
  closeAiView: (kind, payload) => ipcRenderer.invoke("ai-tabs:close", { ...(payload || {}), kind }),
  setActiveAiKind: (kind) => ipcRenderer.invoke("ai:set-active-kind", { kind }),
  closeAllAiWorkspaces: () => ipcRenderer.invoke("ai:close-all"),
  ensureAiWorkspace: (payload) => ipcRenderer.invoke("ai:ensure", payload),
  activateAiEnvironment: (payload) => ipcRenderer.invoke("ai:environment-activate", payload),
  deleteAiEnvironment: (payload) => ipcRenderer.invoke("ai:environment-delete", payload),
  checkAiEnvironmentEgress: (payload) => ipcRenderer.invoke("ai:environment-egress-check", payload),
  syncAiViewHost: (payload) => ipcRenderer.invoke("ai:sync-host", payload),
  navigateAiWorkspace: (payload) => ipcRenderer.invoke("ai:navigate", payload),
  checkAiProxy: (kind, tabId, context) =>
    ipcRenderer.invoke("ai:proxy-check", { ...(context || {}), kind, tabId }),
  clearAiBrowserData: (kind, confirmation) =>
    ipcRenderer.invoke("ai:data-clear", { kind, ...(confirmation || {}) }),
  rebuildAiBrowserProfile: (kind, confirmation) =>
    ipcRenderer.invoke("ai:profile-rebuild", { kind, ...(confirmation || {}) }),
  captureBrowserFingerprint: (kind, tabId) =>
    ipcRenderer.invoke("browser-privacy:capture", { kind, tabId }),
  applyBrowserPrivacy: () => ipcRenderer.invoke("browser-privacy:apply"),
  detectProxyEnvironment: () => ipcRenderer.invoke("browser-privacy:detect-proxy-environment"),
  installAiQueryTracker: (payload) => ipcRenderer.invoke("ai:install-query-tracker", payload),
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
