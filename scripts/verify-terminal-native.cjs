const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const asar = require("@electron/asar");
const { finished } = require("node:stream/promises");
const { verifyPackagedDependencies } = require("./verify-packaged-dependencies.cjs");

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-pty-package-"));
  try {
    const source = path.join(temp, "source");
    fs.mkdirSync(source);
    fs.writeFileSync(
      path.join(source, "package.json"),
      JSON.stringify({ name: "terminal-native-fixture", dependencies: { "node-pty": "1.1.0" } }),
    );
    for (const name of ["node-pty", "node-addon-api"])
      fs.cpSync(
        path.dirname(require.resolve(`${name}/package.json`)),
        path.join(source, "node_modules", name),
        { recursive: true },
      );
    const archive = path.join(temp, "app.asar");
    const output = await asar.createPackageWithOptions(source, archive, {
      unpackDir: "node_modules/node-pty",
    });
    await finished(output);
    verifyPackagedDependencies(archive);
    const code = `
      const pty=require(${JSON.stringify(path.join(archive, "node_modules/node-pty"))});
      const windows=process.platform==='win32';
      const child=pty.spawn(windows?'powershell.exe':'/bin/sh',windows?['-NoLogo','-NoProfile','-Command',"[Console]::Write('PACKAGED_PTY_OK')"]:['-c','printf PACKAGED_PTY_OK'],{cols:80,rows:24,cwd:${JSON.stringify(temp)},env:{...process.env}});
      let output=''; child.onData(d=>output+=d);
      child.onExit(e=>{console.log(JSON.stringify({exit:e.exitCode,output}));if(e.exitCode||!output.includes('PACKAGED_PTY_OK'))process.exitCode=1;});
    `;
    const result = spawnSync(require("electron"), ["-e", code], {
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    if (result.error || result.status !== 0)
      throw new Error(
        `Packaged PTY did not start: ${result.error || result.stderr || result.stdout}`,
      );
    console.log(result.stdout.trim());
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
