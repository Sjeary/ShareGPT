const { execFileSync } = require("node:child_process");
const path = require("node:path");

function legacyReleaseCommands({ version, tag, platform }) {
  if (version !== "1.0.9" || tag !== "v1.0.9") {
    throw new Error("The unsigned publication exception applies only to v1.0.9.");
  }
  if (platform !== "darwin" && platform !== "win32") {
    throw new Error("Legacy release supports only macOS and Windows.");
  }
  const node = process.execPath;
  const builder = "node_modules/electron-builder/cli.js";
  /** @type {Array<[string, string[], string?]>} */
  const commands = [
    [node, ["src/renderer-next/node_modules/typescript/bin/tsc", "-b", "src/renderer-next"]],
    [node, ["node_modules/vite/bin/vite.js", "build"], "src/renderer-next"],
    [node, ["scripts/prepare-assets.mjs", platform === "darwin" ? "sender" : "all", "--required"]],
  ];
  if (platform === "win32") {
    commands.push([node, [builder, "--win", "nsis", "--x64", "--publish", "never"]]);
    return commands;
  }
  const config = [
    "--config",
    "build.sender.json",
    "-c.mac.notarize=false",
    "-c.mac.hardenedRuntime=false",
    "--publish",
    "never",
  ];
  const app = "release_sender/mac-arm64/ShareGPT.app";
  commands.push(
    [node, [builder, "--mac", "dir", "--arm64", ...config]],
    [node, ["scripts/sign-local-macos.mjs", app]],
    ["codesign", ["--verify", "--deep", "--strict", app]],
    [node, [builder, "--mac", "dmg", "zip", "--arm64", "--prepackaged", app, ...config]],
  );
  return commands;
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  const commands = legacyReleaseCommands({
    version: require("../package.json").version,
    tag: process.env.SHAREGPT_RELEASE_TAG || process.env.GITHUB_REF_NAME,
    platform: process.platform,
  });
  for (const [command, args, relativeCwd] of commands) {
    execFileSync(command, args, {
      cwd: relativeCwd ? path.join(root, relativeCwd) : root,
      stdio: "inherit",
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
    });
  }
}

module.exports = { legacyReleaseCommands };
