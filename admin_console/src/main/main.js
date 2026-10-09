const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { URL, pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { configureAdminUserData } = require("./userDataPath");

// Configure storage before whenReady can create Chromium sessions.
app.setName("ShareGPT Admin");
configureAdminUserData(app);
const backgroundTest = !app.isPackaged && process.env.SHAREGPT_ADMIN_TEST_HIDDEN === "1";
if (backgroundTest && process.platform === "darwin") app.setActivationPolicy("prohibited");

let mainWindow = null;
let rendererDocument = "";
const selectedReleaseFiles = new Set();
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

function documentIdentity(value) {
  try {
    const url = new URL(value);
    if (!["file:", "http:", "https:"].includes(url.protocol)) return "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function getEventWindow(event) {
  const contents = mainWindow?.webContents;
  if (
    !contents ||
    contents.isDestroyed() ||
    event?.sender !== contents ||
    !event.senderFrame ||
    event.senderFrame !== contents.mainFrame ||
    !rendererDocument ||
    documentIdentity(event.senderFrame.url) !== rendererDocument
  ) {
    throw new Error("此页面无权调用管理员桌面功能");
  }
  return mainWindow;
}

function handle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    getEventWindow(event);
    return handler(event, ...args);
  });
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
    show: !backgroundTest,
    focusable: !backgroundTest,
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

  const contents = mainWindow.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  const guardNavigation = (event, url) => {
    if (documentIdentity(url) !== rendererDocument) event.preventDefault();
  };
  contents.on("will-navigate", guardNavigation);
  contents.on("will-redirect", guardNavigation);
  contents.on("will-attach-webview", (event) => event.preventDefault());
  loadRenderer(mainWindow);
  mainWindow.on("closed", () => {
    mainWindow = null;
    rendererDocument = "";
    selectedReleaseFiles.clear();
  });
}

// UI 加载策略: 开发热更新使用 Vite，安装包只使用经过构建验证的 React UI。
// 缺少 ui/dist 属于打包错误，必须明确失败，不能静默退回功能不完整的旧管理界面。
function loadRenderer(win) {
  const devUrl = process.env.ADMIN_UI_DEV_URL;
  if (devUrl && !app.isPackaged) {
    rendererDocument = documentIdentity(devUrl);
    if (!rendererDocument) throw new Error("无效的管理端开发页面地址");
    win.loadURL(devUrl);
    return;
  }
  const builtUi = path.join(__dirname, "../../ui/dist/index.html");
  if (fs.existsSync(builtUi)) {
    rendererDocument = documentIdentity(pathToFileURL(builtUi).href);
    win.loadFile(builtUi);
    return;
  }
  dialog.showErrorBox(
    "ShareGPT Admin 资源缺失",
    "没有找到已构建的管理界面。请重新安装完整版本，开发环境请先运行 npm run build:ui。",
  );
  app.quit();
}

app.whenReady().then(() => {
  handle("prefs:load", () => loadPrefs());
  handle("prefs:save", (_event, data) => savePrefs(data || {}));
  handle("app:version", () => app.getVersion());
  handle("window:minimize", (event) => {
    getEventWindow(event)?.minimize();
    return true;
  });
  handle("window:toggle-maximize", (event) => {
    const target = getEventWindow(event);
    if (!target) return false;
    if (target.isMaximized()) {
      target.unmaximize();
      return false;
    }
    target.maximize();
    return true;
  });
  handle("window:is-maximized", (event) => {
    const target = getEventWindow(event);
    return target ? target.isMaximized() : false;
  });
  handle("window:is-fullscreen", (event) => {
    const target = getEventWindow(event);
    return target ? target.isFullScreen() : false;
  });
  handle("window:close", (event) => {
    getEventWindow(event)?.close();
    return true;
  });
  handle("dialog:select-release", async (event) => {
    const result = await dialog.showOpenDialog(getEventWindow(event), {
      title: "选择安装包",
      properties: ["openFile"],
      filters: [
        { name: "安装包", extensions: ["exe", "dmg", "zip", "pkg", "msi"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return null;
    getEventWindow(event);
    const filePath = fs.realpathSync(result.filePaths[0]);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error("请选择有效的安装包文件");
    selectedReleaseFiles.add(filePath);
    return {
      filePath,
      fileName: path.basename(filePath),
      size: stat.size,
    };
  });
  handle("release:upload", (event, payload) => {
    const filePath = fs.realpathSync(String(payload?.filePath || ""));
    if (!selectedReleaseFiles.has(filePath)) throw new Error("请先通过文件选择器选择安装包");
    return uploadReleaseFile({ ...payload, filePath }, (progress) => {
      try {
        getEventWindow(event);
        event.sender.send("release:upload-progress", progress);
      } catch {
        // The originating window may have closed while an upload was running.
      }
    });
  });

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
