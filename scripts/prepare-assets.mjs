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
  const explicit = fileName === names.singbox ? process.env.CHATPORTAL_SINGBOX_PATH : process.env.CHATPORTAL_FRPC_PATH;
  const binDir = process.env.CHATPORTAL_BIN_DIR;
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
      return;
    }
  }

  throw new Error(
    `未找到 ${label} 二进制: ${fileName}。请放到 build/bin/、build/bin/${platform}/，或通过 CHATPORTAL_BIN_DIR / 专用环境变量指定。`,
  );
}

async function main() {
  await ensureDir(outputDir);
  await copyOne("sing-box", names.singbox);

  try {
    await copyOne("frpc", names.frpc);
  } catch (err) {
    console.warn(`[assets] frpc 未准备，Receiver 模式将无法运行: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
