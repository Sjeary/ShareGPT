const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const npmCacheExclusion = "!src/**/.npm-cache{,/**/*}";

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

test("所有 Electron 打包配置都排除本机 npm 缓存", () => {
  const configs = [
    ["package.json", readJson("package.json").build],
    ["build.sender.json", readJson("build.sender.json")],
    ["build.receiver.json", readJson("build.receiver.json")],
  ];

  for (const [name, config] of configs) {
    assert.ok(config.files.includes(npmCacheExclusion), `${name} 缺少 ${npmCacheExclusion}`);
  }
});
