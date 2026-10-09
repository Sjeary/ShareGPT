const fs = require("node:fs");
const path = require("node:path");
// node-pty's npm prebuild can ship its macOS helper without executable bits.
// Keep development, npm ci and packaged builds on the same preparation path.
const root = path.dirname(require.resolve("node-pty/package.json"));
if (process.platform !== "win32") {
  for (const dir of ["build/Release", `prebuilds/${process.platform}-${process.arch}`]) {
    const helper = path.join(root, dir, "spawn-helper");
    if (fs.existsSync(helper)) fs.chmodSync(helper, fs.statSync(helper).mode | 0o111);
  }
}
