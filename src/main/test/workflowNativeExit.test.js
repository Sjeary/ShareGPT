const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function windowsCommandGuards() {
  const commands = [];
  for (const [file, job] of [
    ["ci.yml", "windows-package"],
    ["release.yml", "windows"],
  ]) {
    const text = fs.readFileSync(
      path.resolve(__dirname, "../../../.github/workflows", file),
      "utf8",
    );
    const jobStart = text.indexOf(`  ${job}:\n`);
    assert.ok(jobStart >= 0);
    const jobBody = text.slice(jobStart + job.length + 4).split(/\n {2}[\w-]+:\n/)[0];
    const lines = jobBody.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s+(?:\$\w+\s*=\s*)?(?:npm|node)\s/.test(lines[i])) continue;
      commands.push({ file, command: lines[i].trim(), guard: (lines[i + 1] || "").trim() });
    }
  }
  assert.ok(commands.length >= 15, "both Windows job bodies were inspected");
  return commands;
}

test("Windows multiline CI and release steps stop after each native command failure", () => {
  for (const { file, command, guard } of windowsCommandGuards()) {
    assert.match(
      guard,
      /^if \(\$LASTEXITCODE -ne 0\) \{ (?:exit \$LASTEXITCODE|throw .+) \}$/,
      `${file}: ${command}`,
    );
  }
});

test(
  "actual PowerShell native failures cannot reach a later successful command",
  {
    skip: process.platform !== "win32" ? "requires the Windows runner's PowerShell" : false,
  },
  () => {
    // Execute the checked-in guards, injecting a real failing native process.
    // Disable automatic native-error promotion to exercise the explicit guard.
    for (const guard of new Set(windowsCommandGuards().map((item) => item.guard))) {
      const quote = (value) => `'${value.replace(/'/g, "''")}'`;
      const script = `$ErrorActionPreference = 'Stop'\n$PSNativeCommandUseErrorActionPreference = $false\n& ${quote(process.execPath)} -e 'process.exit(23)'\n${guard}\nWrite-Output 'must-not-continue'\n& ${quote(process.execPath)} -e 'process.exit(0)'\n`;
      const result = spawnSync(
        "pwsh",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        { encoding: "utf8", timeout: 15000 },
      );
      assert.ifError(result.error);
      assert.notEqual(result.status, 0, guard);
      assert.doesNotMatch(result.stdout, /must-not-continue/, guard);
      if (guard.includes("exit $LASTEXITCODE")) assert.equal(result.status, 23);
    }
  },
);
