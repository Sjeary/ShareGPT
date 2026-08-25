const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getProfileContext: () => ipcRenderer.invoke("profile:get-context"),
  emitProfileUpdated: (payload) => ipcRenderer.send("profile:updated", payload),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
});
