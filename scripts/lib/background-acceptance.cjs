const fs = require("node:fs");
const path = require("node:path");
const { applyStableUserDataPath } = require("../../src/main/userDataPath");

// Direct Electron fixtures do not enter appFactory, so isolate them before app.whenReady.
function prepareBackgroundAcceptance(app, environment = process.env) {
  if (app.isPackaged) throw new Error("This acceptance bootstrap is for source fixtures only");
  if (!environment.SHAREGPT_USER_DATA) {
    const root = path.resolve(__dirname, "../../.cache/electron-acceptance");
    fs.mkdirSync(root, { recursive: true });
    environment.SHAREGPT_USER_DATA = fs.mkdtempSync(path.join(root, "profile-"));
  }
  environment.SHAREGPT_BACKGROUND_TEST = "1";
  const directory = applyStableUserDataPath(app, environment);
  for (const [name, child] of [
    ["temp", "tmp"],
    ["crashDumps", "crashes"],
    ["downloads", "downloads"],
  ]) {
    const target = path.join(directory, child);
    fs.mkdirSync(target, { recursive: true });
    app.setPath(name, target);
  }
  app.setAppLogsPath(path.join(directory, "logs"));
  if (process.platform === "darwin") app.setActivationPolicy("prohibited");
  app.on("browser-window-created", (_event, win) => {
    if (win.isVisible()) throw new Error("Background acceptance created a visible window");
    win.setFocusable(false);
  });
  return directory;
}

module.exports = { prepareBackgroundAcceptance };
