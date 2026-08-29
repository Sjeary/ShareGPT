import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { EXPECTED_APP_ID, releaseContractFailures } = require("./releaseContract.cjs");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const senderBuild = readJson("build.sender.json");
const compatibility = readJson("release.compatibility.json");
const version = String(packageJson.version).trim();
const releaseTag = String(process.env.SHAREGPT_RELEASE_TAG || "").trim();
const failures = releaseContractFailures({
  packageJson,
  packageLock,
  senderBuild,
  compatibility,
  releaseTag,
});

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `Release contract verified: v${version}, ${EXPECTED_APP_ID}, sharegpt-${version} artifacts.`,
);
