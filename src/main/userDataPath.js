const fs = require("node:fs");
const path = require("node:path");

function copyMissingChromiumPartitions(sourceDir, targetDir, conflicts = []) {
  if (!sourceDir || !targetDir || !fs.existsSync(sourceDir)) return conflicts;
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (fs.existsSync(targetPath)) {
      conflicts.push({
        type: "chromium-partition-conflict",
        partition: entry.name,
        source: sourcePath,
        target: targetPath,
      });
      continue;
    }
    if (entry.isDirectory()) {
      fs.cpSync(sourcePath, targetPath, { recursive: true, errorOnExist: true });
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
    }
  }
  return conflicts;
}

function copyMissingUserDataEntries(sourceDir, targetDir, options = {}) {
  const conflicts = options.conflicts || [];
  if (!sourceDir || !targetDir) return conflicts;
  const from = path.resolve(sourceDir);
  const to = path.resolve(targetDir);
  if (from === to || !fs.existsSync(from)) return conflicts;

  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const sourcePath = path.join(from, entry.name);
    const targetPath = path.join(to, entry.name);
    if (options.userDataRoot !== false && entry.name === "Partitions" && entry.isDirectory()) {
      copyMissingChromiumPartitions(sourcePath, targetPath, conflicts);
      continue;
    }
    if (fs.existsSync(targetPath)) {
      if (entry.isDirectory() && fs.statSync(targetPath).isDirectory()) {
        copyMissingUserDataEntries(sourcePath, targetPath, {
          conflicts,
          userDataRoot: false,
        });
      }
      continue;
    }
    if (entry.isDirectory()) {
      fs.cpSync(sourcePath, targetPath, { recursive: true, errorOnExist: false });
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
  return conflicts;
}

// Resolve existing ancestors too, so a not-yet-created child of a symlink cannot
// redirect development writes into the installed application's profile.
function resolveProfilePath(directory) {
  const absolute = path.resolve(directory);
  try {
    return fs.realpathSync(absolute);
  } catch (error) {
    if (error.code !== "ENOENT" || path.dirname(absolute) === absolute) throw error;
    return path.join(resolveProfilePath(path.dirname(absolute)), path.basename(absolute));
  }
}

function applyStableUserDataPath(appInstance, environment = process.env) {
  if (!appInstance.isPackaged) {
    const devUserDataDir = resolveProfilePath(
      environment.SHAREGPT_USER_DATA || path.join(appInstance.getAppPath(), ".cache", "user-data"),
    );
    const installedUserDataDir = resolveProfilePath(
      path.join(appInstance.getPath("appData"), "ShareGPT"),
    );
    const overlaps = (parent, child) => {
      const relative = path.relative(parent, child);
      return (
        relative === "" ||
        (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
      );
    };
    if (
      overlaps(installedUserDataDir, devUserDataDir) ||
      overlaps(devUserDataDir, installedUserDataDir)
    ) {
      throw new Error(
        "Development user data must be separate from the installed ShareGPT profile.",
      );
    }
    fs.mkdirSync(devUserDataDir, { recursive: true });
    appInstance.setPath("userData", devUserDataDir);
    appInstance.setPath("sessionData", devUserDataDir);
    return devUserDataDir;
  }

  const legacyUserDataDir = appInstance.getPath("userData");
  const stableUserDataDir = path.join(appInstance.getPath("appData"), "ShareGPT");
  try {
    const conflicts = copyMissingUserDataEntries(legacyUserDataDir, stableUserDataDir);
    if (conflicts.length) {
      fs.writeFileSync(
        path.join(stableUserDataDir, "user_data_migration_report.json"),
        JSON.stringify(
          {
            checkedAt: new Date().toISOString(),
            sourceUserData: path.resolve(legacyUserDataDir),
            targetUserData: path.resolve(stableUserDataDir),
            conflicts,
          },
          null,
          2,
        ),
        "utf-8",
      );
    }
  } catch (error) {
    console.warn("Unable to migrate existing user data:", error.message || error);
    return legacyUserDataDir;
  }
  appInstance.setPath("userData", stableUserDataDir);
  return stableUserDataDir;
}

module.exports = {
  applyStableUserDataPath,
  copyMissingChromiumPartitions,
  copyMissingUserDataEntries,
};
