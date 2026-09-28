const path = require("node:path");
const asar = require("@electron/asar");

// Inspect the archive, not the development checkout: hoisted or linked modules
// can resolve during tests while being absent from the installed application.
function verifyPackagedDependencies(archive) {
  const files = new Set(asar.listPackage(archive).map((file) => file.replace(/^\//, "")));
  const visited = new Set();
  const pending = [""];
  const missing = [];
  while (pending.length) {
    const directory = pending.pop();
    if (visited.has(directory)) continue;
    visited.add(directory);
    const manifest = JSON.parse(
      asar.extractFile(archive, path.posix.join(directory, "package.json")).toString(),
    );
    for (const dependency of Object.keys(manifest.dependencies || {})) {
      if (Object.hasOwn(manifest.optionalDependencies || {}, dependency)) continue;
      let base = directory;
      let found;
      while (true) {
        const candidate = path.posix.join(base, "node_modules", dependency);
        if (files.has(path.posix.join(candidate, "package.json"))) {
          found = candidate;
          break;
        }
        if (!base) break;
        const parent = path.posix.dirname(base);
        base = parent === "." ? "" : parent;
      }
      if (found) pending.push(found);
      else missing.push(`${manifest.name || "application"} requires ${dependency}`);
    }
  }
  if (missing.length) throw new Error(`Packaged dependencies missing:\n${missing.join("\n")}`);
  return visited.size;
}

if (require.main === module) {
  const archive = process.argv[2];
  if (!archive) throw new Error("Usage: node verify-packaged-dependencies.cjs <app.asar>");
  console.log(
    `Packaged dependency closure verified: ${verifyPackagedDependencies(archive)} packages`,
  );
}
module.exports = { verifyPackagedDependencies };
