const { pathToFileURL } = require("node:url");

function documentIdentity(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!["file:", "http:", "https:"].includes(url.protocol)) return "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

// Window creation owns the windows. This boundary owns only their IPC grants, bound to
// the exact bundled (or explicitly selected development) document and its main frame.
function createTrustedIpc({ ipcMain, openExternal }) {
  const grants = new Map();
  function allowedRoles(channel) {
    if (["profile:theme", "profile:updated"].includes(channel)) return ["profile"];
    if (
      [
        "window:minimize",
        "window:toggle-maximize",
        "window:close",
        "window:is-maximized",
        "window:is-fullscreen",
        "window:toggle-fullscreen",
        "settings:principal-context",
      ].includes(channel)
    ) {
      return ["main", "profile"];
    }
    return ["main"];
  }
  function assertSender(event, roles) {
    const grant = grants.get(event?.sender?.id);
    if (
      !grant ||
      grant.contents !== event.sender ||
      grant.contents.isDestroyed() ||
      !roles.includes(grant.role) ||
      !event.senderFrame ||
      event.senderFrame !== grant.contents.mainFrame ||
      documentIdentity(event.senderFrame.url) !== grant.document
    ) {
      throw new Error("此页面无权调用该桌面功能");
    }
  }
  return {
    registerWindow(window, entry, role) {
      const contents = window.webContents;
      const document = documentIdentity(
        entry.type === "file" ? pathToFileURL(entry.target).href : entry.target,
      );
      if (!document) throw new Error("无效的桌面页面入口");
      grants.set(contents.id, { contents, document, role });
      contents.once("destroyed", () => grants.delete(contents.id));
      contents.setWindowOpenHandler(({ url }) => {
        void Promise.resolve(openExternal(url)).catch(() => {});
        return { action: "deny" };
      });
      const guard = (event, url) => {
        if (documentIdentity(url) === document) return;
        event.preventDefault();
      };
      contents.on("will-navigate", (event, url) => {
        guard(event, url);
        if (event.defaultPrevented) void Promise.resolve(openExternal(url)).catch(() => {});
      });
      contents.on("will-redirect", guard);
      contents.on("will-attach-webview", (event) => event.preventDefault());
    },
    handle(channel, handler, roles = allowedRoles(channel)) {
      ipcMain.handle(channel, (event, ...args) => {
        assertSender(event, roles);
        return handler(event, ...args);
      });
    },
    on(channel, handler, roles = allowedRoles(channel)) {
      ipcMain.on(channel, (event, ...args) => {
        // send() has no rejection channel. Drop unauthorized fire-and-forget messages.
        try {
          assertSender(event, roles);
        } catch {
          return;
        }
        handler(event, ...args);
      });
    },
  };
}

module.exports = { createTrustedIpc, documentIdentity };
