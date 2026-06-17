const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  platform: process.platform,
  setThemeSource: (source) => ipcRenderer.invoke("app:set-theme-source", source),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  importSettings: () => ipcRenderer.invoke("settings:import"),
  loadChatHistory: () => ipcRenderer.invoke("chat-history:load"),
  saveChatHistory: (payload) => ipcRenderer.invoke("chat-history:save", payload),
  exportUserData: () => ipcRenderer.invoke("user-data:export"),
  importUserData: () => ipcRenderer.invoke("user-data:import"),
  readClipboardAttachment: () => ipcRenderer.invoke("clipboard:read-attachment"),

  getStatus: () => ipcRenderer.invoke("service:status"),
  getPaths: () => ipcRenderer.invoke("app:paths"),
  getAppMeta: () => ipcRenderer.invoke("app:meta"),
  getDeviceInfo: () => ipcRenderer.invoke("app:device-info"),
  getMode: () => ipcRenderer.invoke("app:mode"),
  downloadAppUpdate: (payload) => ipcRenderer.invoke("app:update-download", payload),
  openAppUpdate: (payload) => ipcRenderer.invoke("app:update-open", payload),
  showSystemNotification: (payload) => ipcRenderer.invoke("notifications:show", payload),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  listGptViews: () => ipcRenderer.invoke("gpt-tabs:list"),
  createGptView: (payload) => ipcRenderer.invoke("gpt-tabs:create", payload),
  switchGptView: (payload) => ipcRenderer.invoke("gpt-tabs:switch", payload),
  closeGptView: (payload) => ipcRenderer.invoke("gpt-tabs:close", payload),
  ensureAiWorkspace: (payload) => ipcRenderer.invoke("ai:ensure", payload),
  syncAiViewHost: (payload) => ipcRenderer.invoke("ai:sync-host", payload),
  navigateAiWorkspace: (payload) => ipcRenderer.invoke("ai:navigate", payload),
  executeAiJavaScript: (payload) => ipcRenderer.invoke("ai:execute-javascript", payload),
  openProfileEditor: (payload) => ipcRenderer.invoke("profile:open", payload),
  emitProfileUpdated: (payload) => ipcRenderer.send("profile:updated", payload),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),

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
