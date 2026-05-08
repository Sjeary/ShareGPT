import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
const isWindows = platform === "windows";

const names = {
  singbox: isWindows ? "sing-box.exe" : "sing-box",
  frpc: isWindows ? "frpc.exe" : "frpc",
};

const outputDir = path.join(projectRoot, "build", "bin");
const argv = process.argv.slice(2);
const cliMode = argv
  .map((item) => String(item || "").trim().toLowerCase())
  .find((item) => item === "sender" || item === "receiver" || item === "all") || "all";
const required = argv.some((item) => {
  const value = String(item || "").trim().toLowerCase();
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
  const explicitNames = fileName === names.singbox
    ? ["SHAREGPT_SINGBOX_PATH"]
    : ["SHAREGPT_FRPC_PATH"];
  const explicit = explicitNames.map((name) => process.env[name]).find((value) => String(value || "").trim());
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

async function copyOne(label, fileName) {
  const dest = path.join(outputDir, fileName);

  for (const candidate of candidates(fileName)) {
    if (await exists(candidate)) {
      if (path.resolve(candidate) === path.resolve(dest)) {
        if (!isWindows) {
          await fs.chmod(dest, 0o755);
        }
        console.log(`[assets] ${label}: using existing ${dest}`);
        return;
      }
      await fs.copyFile(candidate, dest);
      if (!isWindows) {
        await fs.chmod(dest, 0o755);
      }
      console.log(`[assets] ${label}: ${candidate} -> ${dest}`);
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
