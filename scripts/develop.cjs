const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const packages = [".", "src/renderer-next", "admin_console/ui", "collab_server2"];
const command = process.argv[2];

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(executable)} 执行失败（${result.signal || result.status}）`);
  }
}

function npm(args) {
  if (!process.env.npm_execpath) throw new Error("请通过 npm run 执行此脚本。");
  run(process.execPath, [process.env.npm_execpath, ...args]);
}

function doctor() {
  for (const directory of packages) {
    const manifest = path.join(root, directory, "node_modules");
    if (!fs.existsSync(manifest))
      throw new Error(`${directory} 缺少依赖，请运行 npm run setup:dev`);
  }
  const electronDirectory = path.dirname(require.resolve("electron/package.json"));
  const electronPath = path.join(electronDirectory, "path.txt");
  if (
    !fs.existsSync(electronPath) ||
    !fs.existsSync(path.join(electronDirectory, "dist", fs.readFileSync(electronPath, "utf8")))
  ) {
    throw new Error("Electron 尚未下载完成，请运行 npm run setup:dev");
  }
  run(process.execPath, ["scripts/prepare-assets.mjs", "sender", "--required"]);
  console.log(
    `开发环境检查通过：Node ${process.versions.node}，${process.platform}/${process.arch}`,
  );
  console.log("启动客户端：npm run dev；运行测试：npm test");
}

try {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12))
    throw new Error("需要 Node.js 22.12 或更新版本。");
  if (command === "setup") {
    if (
      !(
        (process.platform === "win32" && process.arch === "x64") ||
        (process.platform === "darwin" && process.arch === "arm64")
      )
    ) {
      throw new Error(
        "自动资源准备支持 Windows x64 和 macOS arm64；其他平台请按 build/bin/README.md 准备资源。",
      );
    }
    for (const directory of packages) {
      npm(["--prefix", directory, "ci", "--no-audit", "--no-fund"]);
    }
    // Electron 43 downloads lazily; finish that step before declaring setup ready.
    run(process.execPath, ["-e", "require('electron')"]);
    if (process.platform === "win32") {
      run("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(root, "scripts/prepare-windows-release-assets.ps1"),
      ]);
    } else {
      run("bash", ["scripts/prepare-macos-release-assets.sh"]);
    }
    doctor();
  } else if (command === "doctor") {
    doctor();
  } else if (command === "start") {
    npm(["run", "build:next"]);
    run(process.execPath, ["scripts/prepare-assets.mjs", "sender", "--required"]);
    const env = { ...process.env };
    // Editor hosts can export this for their own Electron process. The client
    // must start as an application even when launched from that editor's terminal.
    delete env.ELECTRON_RUN_AS_NODE;
    run(require("electron"), [root, ...process.argv.slice(3)], { env });
  } else {
    throw new Error("用法：npm run setup:dev | npm run doctor | npm run dev");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
