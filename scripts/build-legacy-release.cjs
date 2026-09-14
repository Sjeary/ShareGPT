const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { releaseDistribution } = require("./release-distribution.cjs");

function legacyReleaseEnvironment(input) {
  const env = { ...input, CSC_IDENTITY_AUTO_DISCOVERY: "false" };
  for (const name of ["CSC_LINK", "CSC_KEY_PASSWORD", "WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"]) {
    delete env[name];
  }
  return env;
}

function legacyReleaseCommands({ version, tag, platform }) {
  if (releaseDistribution({ version, tag }) !== "legacy") {
    throw new Error("Unsigned publication requires an explicitly approved exact release.");
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
  const env = legacyReleaseEnvironment(process.env);
  for (const [command, args, relativeCwd] of commands) {
    execFileSync(command, args, {
      cwd: relativeCwd ? path.join(root, relativeCwd) : root,
      stdio: "inherit",
      env,
    });
  }
}

module.exports = { legacyReleaseCommands, legacyReleaseEnvironment };
