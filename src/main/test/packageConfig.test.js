const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { FileMatcher } = require("app-builder-lib/out/fileMatcher");

const root = path.resolve(__dirname, "../../..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

test("Electron packaging excludes development profiles and caches while retaining product files", () => {
  const configs = [
    ["package.json", readJson("package.json").build],
    ["build.sender.json", readJson("build.sender.json")],
    ["build.receiver.json", readJson("build.receiver.json")],
  ];

  for (const [name, config] of configs) {
    const filter = new FileMatcher(root, root, (value) => value, config.files).createFilter();
    const fileStat = fs.statSync(__filename);
    for (const relative of [
      "src/main/.cache/user-data/settings.json",
      "src/main/.cache/user-data/Partitions/gpt/Cookies",
      "src/renderer-next/.npm-cache/_logs/install.log",
    ]) {
      assert.equal(filter(path.join(root, relative), fileStat), false, `${name}: ${relative}`);
    }
    for (const relative of ["src/main/main_sender.js", "src/renderer-next/dist/index.html"]) {
      assert.equal(filter(path.join(root, relative), fileStat), true, `${name}: ${relative}`);
    }
  }
});

test("client resource filters include sing-box without receiver binaries or duplicate directories", () => {
  for (const config of [readJson("package.json").build, readJson("build.sender.json")]) {
    const resource = config.extraResources[0];
    const source = path.join(root, resource.from);
    const filter = new FileMatcher(
      source,
      source,
      (value) => value,
      resource.filter,
    ).createFilter();
    const fileStat = fs.statSync(__filename);
    for (const name of ["sing-box", "sing-box.exe"]) {
      assert.equal(filter(path.join(source, name), fileStat), true, name);
    }
    for (const name of [
      "frpc.exe",
      "frpc",
      "windows/sing-box.exe",
      "macos/sing-box",
      "checksums.json",
    ]) {
      assert.equal(filter(path.join(source, name), fileStat), false, name);
    }
  }
});
