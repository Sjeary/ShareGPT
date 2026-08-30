import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { releaseSourceFailures } = require("./releaseSourceContract.cjs");
const failures = releaseSourceFailures({
  refType: process.env.GITHUB_REF_TYPE,
  sha: process.env.GITHUB_SHA,
  isAncestor: (sha, branch) =>
    spawnSync("git", ["merge-base", "--is-ancestor", sha, branch], { stdio: "ignore" }).status ===
    0,
});
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  process.env.GITHUB_REF_TYPE === "tag"
    ? `Release source verified: ${process.env.GITHUB_SHA} is contained in origin/main.`
    : "Release source ancestry check skipped for a non-tag run.",
);
