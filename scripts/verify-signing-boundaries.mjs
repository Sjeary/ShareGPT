import { execFileSync } from "node:child_process";
import fs from "node:fs";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const forbiddenNames =
  /(?:^|\/)(?:keychain-password|.*\.(?:p12|pfx|cer|crt|key|keychain|keychain-db))$/i;
const forbiddenContent = /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/;
const violations = [];

for (const file of tracked) {
  if (forbiddenNames.test(file)) {
    violations.push(`${file}: signing secret or private key container must not be tracked`);
    continue;
  }
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 1024 * 1024) continue;
  if (forbiddenContent.test(fs.readFileSync(file, "utf8"))) {
    violations.push(`${file}: embedded private key material must not be tracked`);
  }
}
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const localBuild = String(packageJson?.scripts?.["dist:mac:sender:local"] || "");
const localShell = fs.readFileSync("scripts/sign-local-macos.sh", "utf8");
const localSigner = fs.readFileSync("scripts/sign-local-macos.mjs", "utf8");
if (packageJson?.scripts?.["setup:mac-signing:local"]) {
  violations.push("local signing: must not require a certificate or keychain setup command");
}
if (!localBuild.includes("sign-local-macos.sh")) {
  violations.push("local signing: build must end with the verified ad-hoc signer");
}
if (/\bsecurity\b|keychain-password|\.keychain/i.test(localShell)) {
  violations.push("local signing: must not access a keychain or stored password");
}
if (!localSigner.includes('identity: "-"') || !localSigner.includes("identityValidation: false")) {
  violations.push("local signing: @electron/osx-sign must use the explicit ad-hoc identity");
}
if (!localShell.includes("Signature=adhoc")) {
  violations.push("local signing: output verification must require an ad-hoc signature");
}
if (violations.length) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(
  "Signing boundary verified: local builds are ad-hoc and passwordless; public credentials remain external.",
);
