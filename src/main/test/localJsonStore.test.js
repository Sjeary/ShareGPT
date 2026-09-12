const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readLocalJson, writeLocalJson } = require("../localJsonStore");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-json-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "data.json");
}
test("corrupt desktop primary recovers valid backup while preserving original bytes", (t) => {
  const file = fixture(t);
  writeLocalJson(file, { tasks: ["first"] });
  writeLocalJson(file, { tasks: ["second"] });
  fs.writeFileSync(file, "{broken");
  assert.deepEqual(readLocalJson(file, {}), { tasks: ["first"] });
  const original = fs.readdirSync(path.dirname(file)).find((name) => name.includes(".corrupt-"));
  assert.equal(fs.readFileSync(path.join(path.dirname(file), original), "utf8"), "{broken");
});
test("corrupt desktop data without valid backup rejects both reads and writes", (t) => {
  const file = fixture(t);
  fs.writeFileSync(file, "{broken");
  assert.throws(() => readLocalJson(file, {}), { code: "LOCAL_STORE_UNAVAILABLE" });
  assert.throws(() => writeLocalJson(file, { tasks: [] }), { code: "LOCAL_STORE_UNAVAILABLE" });
  assert.equal(fs.readFileSync(file, "utf8"), "{broken");
});
test("missing primary restores backup; failed final rename preserves previous snapshot", (t) => {
  const file = fixture(t);
  writeLocalJson(file, { tasks: ["first"] });
  writeLocalJson(file, { tasks: ["second"] });
  fs.unlinkSync(file);
  assert.deepEqual(readLocalJson(file, {}), { tasks: ["first"] });
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (to === file) throw Object.assign(new Error("disk failure"), { code: "ENOSPC" });
    return rename(from, to);
  });
  assert.throws(() => writeLocalJson(file, { tasks: [] }), { code: "ENOSPC" });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { tasks: ["first"] });
});
