const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  importSettings: () => ipcRenderer.invoke("settings:import"),

  getStatus: () => ipcRenderer.invoke("service:status"),
  getPaths: () => ipcRenderer.invoke("app:paths"),
  getDeviceInfo: () => ipcRenderer.invoke("app:device-info"),
  getMode: () => ipcRenderer.invoke("app:mode"),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
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
});
