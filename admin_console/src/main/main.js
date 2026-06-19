const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");

let mainWindow = null;
const prefsFile = () => path.join(app.getPath("userData"), "admin_prefs.json");

function loadPrefs() {
  try {
    return JSON.parse(fs.readFileSync(prefsFile(), "utf-8"));
  } catch {
    return {
      serverUrl: "",
      username: "",
    };
  }
}

function savePrefs(data) {
  const next = {
    serverUrl: String(data?.serverUrl || "").trim(),
    username: String(data?.username || "").trim(),
  };
  fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
  fs.writeFileSync(prefsFile(), JSON.stringify(next, null, 2), "utf-8");
  return next;
}

function getEventWindow(event) {
  return BrowserWindow.fromWebContents(event.sender) || mainWindow;
}

function buildUploadHeaders(meta, size) {
  return {
    Authorization: `Bearer ${String(meta?.token || "").trim()}`,
    "Content-Type": "application/octet-stream",
    "Content-Length": String(size),
  };
}

async function uploadReleaseFile(payload = {}, onProgress = null) {
  const serverUrl = String(payload.serverUrl || "")
    .trim()
    .replace(/\/+$/, "");
  const token = String(payload.token || "").trim();
  const filePath = String(payload.filePath || "").trim();
  const emitProgress = typeof onProgress === "function" ? onProgress : () => {};
  if (!serverUrl || !token || !filePath) {
    throw new Error("上传安装包缺少必要参数");
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error("请选择有效的安装包文件");
  }

  const uploadPath =
    String(payload.uploadPath || "/api/admin/releases/upload").trim() ||
    "/api/admin/releases/upload";
  const target = new URL(`${serverUrl}${uploadPath}`);
  target.searchParams.set("platform", String(payload.platformKey || "").trim());
  target.searchParams.set("fileName", path.basename(filePath));
  target.searchParams.set("version", String(payload.version || "").trim());
  target.searchParams.set("notes", String(payload.notes || "").trim());
  const transport = target.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    let transferred = 0;
    const fileName = path.basename(filePath);
    emitProgress({
      platformKey: String(payload.platformKey || "").trim(),
      fileName,
      transferred,
      total: stat.size,
      percent: 0,
    });

    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers: buildUploadHeaders(
          {
            ...payload,
            fileName: path.basename(filePath),
          },
          stat.size,
        ),
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          if ((response.statusCode || 500) < 200 || (response.statusCode || 500) >= 300) {
            reject(new Error(text || `上传失败（${response.statusCode}）`));
            return;
          }
          emitProgress({
            platformKey: String(payload.platformKey || "").trim(),
            fileName: path.basename(filePath),
            transferred: stat.size,
            total: stat.size,
            percent: 100,
            done: true,
          });
          try {
            resolve(JSON.parse(text || "{}"));
          } catch {
            resolve({ ok: true });
          }
        });
      },
    );

    request.on("error", reject);
    request.setTimeout(300000, () => {
      request.destroy(new Error("上传超时"));
    });

    fs.createReadStream(filePath)
      .on("data", (chunk) => {
        transferred += chunk.length;
        emitProgress({
          platformKey: String(payload.platformKey || "").trim(),
          fileName,
          transferred,
          total: stat.size,
          percent: stat.size ? Math.min(100, Math.round((transferred / stat.size) * 100)) : 0,
        });
      })
      .on("error", reject)
      .pipe(request);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    title: "ShareGPT Admin",
    backgroundColor: "#0b1220",
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.platform === "darwin") {
    mainWindow.setWindowButtonVisibility(true);
  }

  loadRenderer(mainWindow);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// UI 加载策略 (对齐 sender):
// - 开发热更新: ADMIN_UI_DEV_URL 指向 Vite dev server。
// - 默认: 加载重构后的 ui/dist 构建产物 (新版 React UI)。
// - 回退: ADMIN_UI_LEGACY=1 或缺产物时, 加载旧的原生 HTML 渲染层。
function loadRenderer(win) {
  const devUrl = process.env.ADMIN_UI_DEV_URL;
  if (devUrl && !app.isPackaged) {
    win.loadURL(devUrl);
    return;
  }
  const builtUi = path.join(__dirname, "../../ui/dist/index.html");
  if (process.env.ADMIN_UI_LEGACY !== "1" && fs.existsSync(builtUi)) {
    win.loadFile(builtUi);
    return;
  }
  win.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  app.setName("ShareGPT Admin");
  app.setPath("userData", path.join(app.getPath("appData"), "ShareGPT Admin"));
  ipcMain.handle("prefs:load", () => loadPrefs());
  ipcMain.handle("prefs:save", (_event, data) => savePrefs(data || {}));
  ipcMain.handle("window:minimize", (event) => {
    getEventWindow(event)?.minimize();
    return true;
  });
  ipcMain.handle("window:toggle-maximize", (event) => {
    const target = getEventWindow(event);
    if (!target) return false;
    if (target.isMaximized()) {
      target.unmaximize();
      return false;
    }
    target.maximize();
    return true;
  });
  ipcMain.handle("window:is-maximized", (event) => {
    const target = getEventWindow(event);
    return target ? target.isMaximized() : false;
  });
  ipcMain.handle("window:is-fullscreen", (event) => {
    const target = getEventWindow(event);
    return target ? target.isFullScreen() : false;
  });
  ipcMain.handle("window:close", (event) => {
    getEventWindow(event)?.close();
    return true;
  });
  ipcMain.handle("dialog:select-release", async (event) => {
    const result = await dialog.showOpenDialog(getEventWindow(event), {
      title: "选择安装包",
      properties: ["openFile"],
      filters: [
        { name: "安装包", extensions: ["exe", "dmg", "zip", "pkg", "msi"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    const stat = fs.statSync(filePath);
    return {
      filePath,
      fileName: path.basename(filePath),
      size: stat.size,
    };
  });
  ipcMain.handle("release:upload", (event, payload) =>
    uploadReleaseFile(payload || {}, (progress) => {
      event.sender.send("release:upload-progress", progress);
    }),
  );

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
