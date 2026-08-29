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

if (violations.length) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log(
  "Signing boundary verified: no tracked certificates, keychains, passwords, or private keys.",
);
