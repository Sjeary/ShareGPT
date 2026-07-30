const asar = require("@electron/asar");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = String(packageJson.version || "").trim();
const releaseDir = String(process.env.SHAREGPT_RELEASE_DIR || "release").trim();

if (!releaseDir || path.isAbsolute(releaseDir) || releaseDir.split(/[\\/]+/).includes("..")) {
  throw new Error(`SHAREGPT_RELEASE_DIR 必须是仓库内的相对路径：${releaseDir}`);
}

function requiredFile(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) throw new Error(`缺少发布产物：${relativePath}`);
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`发布产物为空：${relativePath}`);
  return { filePath, size: stat.size };
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const installerName = `sharegpt-${version}.exe`;
const installer = requiredFile(path.join(releaseDir, installerName));
const blockmap = requiredFile(path.join(releaseDir, `${installerName}.blockmap`));
const latest = requiredFile(path.join(releaseDir, "latest.yml"));
const appAsar = requiredFile(path.join(releaseDir, "win-unpacked", "resources", "app.asar"));
const singBox = requiredFile(
  path.join(releaseDir, "win-unpacked", "resources", "bin", "sing-box.exe"),
);
const frpc = requiredFile(path.join(releaseDir, "win-unpacked", "resources", "bin", "frpc.exe"));

const packagedEntries = asar.listPackage(appAsar.filePath);
const localCacheEntries = packagedEntries.filter((entry) =>
  /(^|[\\/])\.npm-cache([\\/]|$)/.test(entry),
);
if (localCacheEntries.length > 0) {
  throw new Error(`app.asar 包含本机 npm 缓存：${localCacheEntries[0]}`);
}
const rendererIndex = packagedEntries.some(
  (entry) => entry.replace(/\\/g, "/").replace(/^\/+/, "") === "src/renderer-next/dist/index.html",
);
if (!rendererIndex) {
  throw new Error("app.asar 缺少 renderer 入口：src/renderer-next/dist/index.html");
}

const latestText = fs.readFileSync(latest.filePath, "utf8");
if (!new RegExp(`^version:\\s*${version.replace(/\./g, "\\.")}\\s*$`, "m").test(latestText)) {
  throw new Error(`latest.yml 版本号不是 ${version}`);
}
if (
  !latestText.includes(`url: ${installerName}`) ||
  !latestText.includes(`path: ${installerName}`)
) {
  throw new Error(`latest.yml 未指向 ${installerName}`);
}
const declaredSize = Number(latestText.match(/^\s+size:\s*(\d+)\s*$/m)?.[1]);
if (declaredSize !== installer.size) {
  throw new Error(`latest.yml size=${declaredSize}，实际安装包=${installer.size}`);
}

const checksumFile = path.join(root, "build", "bin", "checksums.json");
const checksums = JSON.parse(fs.readFileSync(checksumFile, "utf8"));
for (const [label, asset] of [
  ["sing-box", singBox],
  ["frpc", frpc],
]) {
  const expected = String(checksums?.[label]?.windows?.sha256 || "").toLowerCase();
  const actual = sha256(asset.filePath).toLowerCase();
  if (!expected || actual !== expected) {
    throw new Error(`${label} Windows 二进制校验失败：expected=${expected} actual=${actual}`);
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      target: "nsis",
      version,
      releaseDir,
      installer: {
        path: path.relative(root, installer.filePath),
        bytes: installer.size,
        sha256: sha256(installer.filePath),
      },
      blockmapBytes: blockmap.size,
      latestYml: path.relative(root, latest.filePath),
      packagedResources: {
        appAsarBytes: appAsar.size,
        npmCacheEntries: localCacheEntries.length,
        rendererIndex,
        singBoxBytes: singBox.size,
        frpcBytes: frpc.size,
      },
    },
    null,
    2,
  )}\n`,
);
