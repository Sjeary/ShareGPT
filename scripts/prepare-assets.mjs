import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const platform =
  process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
const isWindows = platform === "windows";

const names = {
  singbox: isWindows ? "sing-box.exe" : "sing-box",
  frpc: isWindows ? "frpc.exe" : "frpc",
};

const outputDir = path.join(projectRoot, "build", "bin");
const argv = process.argv.slice(2);
const cliMode =
  argv
    .map((item) =>
      String(item || "")
        .trim()
        .toLowerCase(),
    )
    .find((item) => item === "sender" || item === "receiver" || item === "all") || "all";
const required = argv.some((item) => {
  const value = String(item || "")
    .trim()
    .toLowerCase();
  return value === "required" || value === "--required" || value === "--strict";
});

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function configuredCandidates(fileName) {
  const explicitNames =
    fileName === names.singbox ? ["SHAREGPT_SINGBOX_PATH"] : ["SHAREGPT_FRPC_PATH"];
  const explicit = explicitNames
    .map((name) => process.env[name])
    .find((value) => String(value || "").trim());
  const binDir = process.env.SHAREGPT_BIN_DIR;
  const result = [];

  if (explicit) {
    result.push(path.resolve(explicit));
  }

  if (binDir) {
    result.push(path.resolve(binDir, platform, fileName));
    result.push(path.resolve(binDir, fileName));
  }

  return result;
}

function candidates(fileName) {
  return [
    ...configuredCandidates(fileName),
    path.join(projectRoot, "build", "bin", platform, fileName),
    path.join(projectRoot, "build", "bin", fileName),
  ];
}

async function sha256File(file) {
  const buf = await fs.readFile(file);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

let checksumsCache;
async function loadChecksums() {
  if (checksumsCache !== undefined) return checksumsCache;
  try {
    checksumsCache = JSON.parse(
      await fs.readFile(path.join(projectRoot, "build", "bin", "checksums.json"), "utf-8"),
    );
  } catch {
    checksumsCache = null;
  }
  return checksumsCache;
}

// 核对二进制 SHA256 是否与固定清单一致。不匹配: 默认告警, --required(构建) 时直接失败。
async function verifyAsset(label, dest) {
  const checksums = await loadChecksums();
  const entry = checksums && checksums[label] && checksums[label][platform];
  if (!entry || !entry.sha256) {
    console.warn(
      `[assets] ${label}: 未固定 ${platform} 校验和 (build/bin/checksums.json), 跳过校验`,
    );
    return;
  }
  const actual = await sha256File(dest);
  if (actual.toLowerCase() !== String(entry.sha256).toLowerCase()) {
    const msg = `${label} 校验和不匹配! 期望 ${entry.sha256} (v${entry.version || "?"}), 实际 ${actual}。可能拿错版本或文件被篡改。`;
    if (required) {
      throw new Error(`[assets] ${msg}`);
    }
    console.warn(`[assets] ${msg}`);
    return;
  }
  console.log(`[assets] ${label}: SHA256 校验通过 ✓ (v${entry.version || "?"})`);
}

async function copyOne(label, fileName) {
  const dest = path.join(outputDir, fileName);

  for (const candidate of candidates(fileName)) {
    if (await exists(candidate)) {
      if (path.resolve(candidate) === path.resolve(dest)) {
        if (!isWindows) {
          await fs.chmod(dest, 0o755);
        }
        console.log(`[assets] ${label}: using existing ${dest}`);
        await verifyAsset(label, dest);
        return;
      }
      await fs.copyFile(candidate, dest);
      if (!isWindows) {
        await fs.chmod(dest, 0o755);
      }
      console.log(`[assets] ${label}: ${candidate} -> ${dest}`);
      await verifyAsset(label, dest);
      return true;
    }
  }
  const message = `${label} 未准备：${fileName}。请先按 build/bin/README.md 准备第三方二进制，或通过 SHAREGPT_BIN_DIR / SHAREGPT_*_PATH 指定。`;
  if (required) {
    throw new Error(message);
  }
  console.warn(
    `[assets] ${message} 仓库仍可继续启动界面；但当前产物如果用于代理功能，将无法正常运行。`,
  );
  return false;
}

async function main() {
  await ensureDir(outputDir);
  const needsSingbox = cliMode === "all" || cliMode === "sender" || cliMode === "receiver";
  const needsFrpc = cliMode === "all" || cliMode === "receiver";

  if (needsSingbox) {
    await copyOne("sing-box", names.singbox);
  }

  if (needsFrpc) {
    await copyOne("frpc", names.frpc);
  }
}
main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
