const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  readJsonStore,
  saveJsonStore,
  saveJsonStoreAsync,
  writeJsonAtomic,
} = require("../json_store");

function fixture(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-json-test-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "store.json");
}

for (const field of ["history", "events"]) {
  test(`${field}: existing JSON remains compatible and keeps previous snapshot`, (context) => {
    const file = fixture(context);
    const first = { [field]: [{ id: "one", usageId: "accepted-once" }] };
    const second = { [field]: [...first[field], { id: "two" }] };
    fs.writeFileSync(file, JSON.stringify(first));
    saveJsonStore(file, second, field);
    assert.deepEqual(readJsonStore(file, field), second);
    assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.backup`, "utf8")), first);
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });

  test(`${field}: corrupt primary recovers backup and preserves original bytes`, (context) => {
    const file = fixture(context);
    const previous = { [field]: [{ id: "kept" }] };
    writeJsonAtomic(`${file}.backup`, previous);
    fs.writeFileSync(file, '{"broken":');
    const warnings = [];
    assert.deepEqual(
      readJsonStore(file, field, (message) => warnings.push(message)),
      previous,
    );
    assert.equal(warnings.length, 1);
    const original = fs.readdirSync(path.dirname(file)).find((name) => name.includes(".corrupt-"));
    assert.ok(original);
    assert.equal(fs.readFileSync(path.join(path.dirname(file), original), "utf8"), '{"broken":');
    assert.deepEqual(readJsonStore(file, field), previous);
  });

  test(`${field}: missing primary restores backup instead of starting empty`, (context) => {
    const file = fixture(context);
    assert.deepEqual(readJsonStore(file, field), { [field]: [] });
    const previous = { [field]: [{ id: "kept" }] };
    writeJsonAtomic(`${file}.backup`, previous);
    assert.deepEqual(
      readJsonStore(file, field, () => {}),
      previous,
    );
  });

  test(`${field}: invalid JSON or schema without backup blocks replacement`, (context) => {
    const file = fixture(context);
    for (const raw of ["{", "null", "{}", JSON.stringify({ [field]: {} })]) {
      fs.writeFileSync(file, raw);
      assert.throws(() => readJsonStore(file, field), /原件保留/);
      assert.throws(() => saveJsonStore(file, { [field]: [] }, field), /原件保留/);
      assert.equal(fs.readFileSync(file, "utf8"), raw);
    }
  });
}

test("failed final replacement preserves primary and backup and removes temporary files", (context) => {
  const file = fixture(context);
  const previous = { events: [{ usageId: "accepted-once" }] };
  writeJsonAtomic(file, previous);
  const rename = fs.renameSync;
  context.mock.method(fs, "renameSync", (source, destination) => {
    if (destination === file) throw new Error("simulated interrupted replacement");
    return rename(source, destination);
  });
  assert.throws(() => saveJsonStore(file, { events: [] }, "events"), /interrupted/);
  assert.deepEqual(readJsonStore(file, "events"), previous);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.backup`, "utf8")), previous);
  assert.equal(
    fs.readdirSync(path.dirname(file)).some((name) => name.endsWith(".tmp")),
    false,
  );
});

test("failed fsync does not replace the last committed JSON", (context) => {
  const file = fixture(context);
  writeJsonAtomic(file, { history: [{ id: "kept" }] });
  context.mock.method(fs, "fsyncSync", () => {
    throw new Error("simulated disk failure");
  });
  assert.throws(() => writeJsonAtomic(file, { history: [] }), /disk failure/);
  assert.deepEqual(readJsonStore(file, "history"), { history: [{ id: "kept" }] });
});

test("async saves stay ordered and let the main event loop continue", async (context) => {
  const file = fixture(context);
  const first = { history: [{ id: "first", text: "x".repeat(8 * 1024 * 1024) }] };
  const second = { history: [{ id: "second" }] };
  let timerFired = false;
  const timer = setTimeout(() => {
    timerFired = true;
  }, 0);
  await Promise.all([
    saveJsonStoreAsync(file, first, "history"),
    saveJsonStoreAsync(file, second, "history"),
  ]);
  clearTimeout(timer);
  assert.equal(timerFired, true, "fsync and JSON serialization must not block the main event loop");
  assert.deepEqual(readJsonStore(file, "history"), second);
  assert.deepEqual(readJsonStore(`${file}.backup`, "history"), first);
});
