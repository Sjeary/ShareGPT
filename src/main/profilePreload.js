const { contextBridge, ipcRenderer } = require("electron");

// The profile editor needs its theme, window controls and update notification only.
// Keep the renderer's API names while withholding settings secrets, vault IO and runtime control.
contextBridge.exposeInMainWorld("api", {
  platform: process.platform,
  getSettingsPrincipal: () => ipcRenderer.invoke("settings:principal-context"),
  loadSettings: () => ipcRenderer.invoke("profile:theme"),
  emitProfileUpdated: (payload) => ipcRenderer.send("profile:updated", payload),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  isWindowFullScreen: () => ipcRenderer.invoke("window:is-fullscreen"),
  toggleWindowFullScreen: (value) => ipcRenderer.invoke("window:toggle-fullscreen", { value }),
  onAppEvent: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("app:event", listener);
    return () => ipcRenderer.removeListener("app:event", listener);
  },
});
