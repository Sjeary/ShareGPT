const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("adminApi", {
  platform: process.platform,
  loadPrefs: () => ipcRenderer.invoke("prefs:load"),
  savePrefs: (payload) => ipcRenderer.invoke("prefs:save", payload),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  isWindowFullScreen: () => ipcRenderer.invoke("window:is-fullscreen"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  selectReleaseFile: () => ipcRenderer.invoke("dialog:select-release"),
  uploadRelease: (payload) => ipcRenderer.invoke("release:upload", payload),
  onReleaseUploadProgress: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("release:upload-progress", listener);
    return () => ipcRenderer.removeListener("release:upload-progress", listener);
  },
});
