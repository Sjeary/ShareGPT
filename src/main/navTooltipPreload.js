const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("navTooltipOverlay", {
  onRenderModel(handler) {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("nav-tooltip-overlay:render", listener);
    return () => ipcRenderer.removeListener("nav-tooltip-overlay:render", listener);
  },
  onCommit(handler) {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("nav-tooltip-overlay:commit", listener);
    return () => ipcRenderer.removeListener("nav-tooltip-overlay:commit", listener);
  },
  reportBootstrapReady() {
    ipcRenderer.send("nav-tooltip-overlay:event", { type: "bootstrap-ready" });
  },
  reportLayoutReady(payload) {
    ipcRenderer.send("nav-tooltip-overlay:event", { type: "layout-ready", ...payload });
  },
  reportFrameReady(payload) {
    ipcRenderer.send("nav-tooltip-overlay:event", { type: "frame-ready", ...payload });
  },
});
