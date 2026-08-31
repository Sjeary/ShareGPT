const fs = require("node:fs");

function resolveRendererEntry({
  builtFile,
  devUrl = "",
  devPath = "",
  isPackaged = false,
  query = {},
  existsSync = fs.existsSync,
}) {
  const search = new URLSearchParams(query || {}).toString();
  if (!isPackaged && String(devUrl || "").trim()) {
    const base = `${String(devUrl).replace(/\/+$/, "")}/`;
    const target = new URL(String(devPath || "").replace(/^\/+/, ""), base);
    target.search = search;
    return { type: "url", target: target.toString() };
  }
  if (!existsSync(builtFile)) {
    throw Object.assign(
      new Error(`Renderer build is missing: ${builtFile}. Run npm run build:next first.`),
      { code: "RENDERER_BUILD_MISSING" },
    );
  }
  return { type: "file", target: builtFile, query: query || {} };
}

function loadRendererEntry(window, entry) {
  if (entry.type === "url") return window.loadURL(entry.target);
  return window.loadFile(entry.target, { query: entry.query });
}

module.exports = { loadRendererEntry, resolveRendererEntry };
