const fs = require("node:fs");
const path = require("node:path");

function resolveDirectory(directory) {
  const absolute = path.resolve(directory);
  try {
    return fs.realpathSync(absolute);
  } catch (error) {
    if (error.code !== "ENOENT" || path.dirname(absolute) === absolute) throw error;
    return path.join(resolveDirectory(path.dirname(absolute)), path.basename(absolute));
  }
}

function overlaps(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

function configureAdminUserData(app, environment = process.env) {
  const installed = path.join(app.getPath("appData"), "ShareGPT Admin");
  const directory = app.isPackaged
    ? installed
    : resolveDirectory(
        environment.SHAREGPT_ADMIN_TEST_USER_DATA ||
          path.join(app.getAppPath(), ".cache", "user-data"),
      );
  if (!app.isPackaged) {
    const live = resolveDirectory(installed);
    if (overlaps(live, directory) || overlaps(directory, live)) {
      throw new Error("Development admin data must be separate from the installed profile.");
    }
    fs.mkdirSync(directory, { recursive: true });
    app.setAppLogsPath(path.join(directory, "logs"));
  }
  app.setPath("userData", directory);
  app.setPath("sessionData", directory);
  return directory;
}

module.exports = { configureAdminUserData };
