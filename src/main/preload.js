const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  platform: process.platform,
  setThemeSource: (source) => ipcRenderer.invoke("app:set-theme-source", source),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  importSettings: () => ipcRenderer.invoke("settings:import"),
  loadChatHistory: () => ipcRenderer.invoke("chat-history:load"),
  saveChatHistory: (payload) => ipcRenderer.invoke("chat-history:save", payload),
  loadCalendar: () => ipcRenderer.invoke("calendar:load"),
  saveCalendar: (payload) => ipcRenderer.invoke("calendar:save", payload),
  loadTasks: () => ipcRenderer.invoke("tasks:load"),
  saveTasks: (payload) => ipcRenderer.invoke("tasks:save", payload),
  // 知识库 vault (笔记文件 IO)。
  vault: {
    start: () => ipcRenderer.invoke("vault:start"),
    getRoot: () => ipcRenderer.invoke("vault:get-root"),
    setRoot: (absPath) => ipcRenderer.invoke("vault:set-root", absPath),
    pickFolder: () => ipcRenderer.invoke("vault:pick-folder"),
    list: () => ipcRenderer.invoke("vault:list"),
    readAll: () => ipcRenderer.invoke("vault:read-all"),
    read: (p) => ipcRenderer.invoke("vault:read", p),
    write: (p, content) => ipcRenderer.invoke("vault:write", { path: p, content }),
    create: (p, content) => ipcRenderer.invoke("vault:create", { path: p, content }),
    rename: (from, to) => ipcRenderer.invoke("vault:rename", { from, to }),
    remove: (p) => ipcRenderer.invoke("vault:remove", p),
    importFrom: (src) => ipcRenderer.invoke("vault:import", src),
  },
  onVaultChanged: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("vault:changed", listener);
    return () => ipcRenderer.removeListener("vault:changed", listener);
  },
  exportUserData: () => ipcRenderer.invoke("user-data:export"),
  importUserData: () => ipcRenderer.invoke("user-data:import"),
  readClipboardAttachment: () => ipcRenderer.invoke("clipboard:read-attachment"),

  getStatus: () => ipcRenderer.invoke("service:status"),
  getPaths: () => ipcRenderer.invoke("app:paths"),
  getAppMeta: () => ipcRenderer.invoke("app:meta"),
  getDeviceInfo: () => ipcRenderer.invoke("app:device-info"),
  getMode: () => ipcRenderer.invoke("app:mode"),
  checkAppUpdate: () => ipcRenderer.invoke("app:update-check"),
  isUpdateSupported: () => ipcRenderer.invoke("app:update-supported"),
  installAppUpdate: () => ipcRenderer.invoke("app:update-install"),
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
  ensureAiWorkspace: (payload) => ipcRenderer.invoke("ai:ensure", payload),
  syncAiViewHost: (payload) => ipcRenderer.invoke("ai:sync-host", payload),
  navigateAiWorkspace: (payload) => ipcRenderer.invoke("ai:navigate", payload),
  checkAiProxy: (kind, tabId) => ipcRenderer.invoke("ai:proxy-check", { kind, tabId }),
  executeAiJavaScript: (payload) => ipcRenderer.invoke("ai:execute-javascript", payload),
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
