const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { PrincipalData } = require("../principalData");
const A = "a".repeat(64),
  B = "b".repeat(64);
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-explicit-data-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, data: new PrincipalData(root) };
}
function seed(root, name, value) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
}
function summary(data, principal, category) {
  return data.inspectLegacy(principal).find((item) => item.category === category);
}

test("path allocation and inspection never claim or modify old root data", (t) => {
  const { root, data } = setup(t);
  const original = seed(root, "tasks.json", '{ "tasks": [{"id":"old"}], "lists":[], "memos":[] }');
  const bytes = fs.readFileSync(original);
  const a = data.file(A, "tasks"),
    b = data.file(B, "tasks");
  assert.notEqual(a, b);
  assert.notEqual(a, original);
  assert.notEqual(data.directory(A), data.directory("local-device"));
  assert.equal(summary(data, A, "tasks").canImport, true);
  assert.equal(summary(data, B, "tasks").canImport, true);
  assert.equal(fs.existsSync(a), false);
  assert.equal(fs.existsSync(path.join(root, "legacy-data-imports.json")), false);
  assert.deepEqual(fs.readFileSync(original), bytes);
  assert.throws(() => data.file(A, "../settings.json"));
});

test("explicit per-category import is bound to source and Principal and claimed once", (t) => {
  const { root, data } = setup(t);
  const original = seed(root, "tasks.json", { lists: [], tasks: [{ id: "old" }], memos: [] });
  const bytes = fs.readFileSync(original);
  const a = summary(data, A, "tasks"),
    b = summary(data, B, "tasks");
  assert.notEqual(a.fingerprint, b.fingerprint);
  assert.throws(() => data.importLegacy(B, "tasks", a.fingerprint), {
    code: "LEGACY_SOURCE_CHANGED",
  });
  data.importLegacy(A, "tasks", a.fingerprint);
  assert.deepEqual(fs.readFileSync(data.file(A, "tasks")), bytes);
  assert.deepEqual(fs.readFileSync(original), bytes);
  assert.equal(summary(data, B, "tasks").canImport, false);
  assert.throws(() => data.importLegacy(A, "tasks", a.fingerprint), {
    code: "LEGACY_ALREADY_IMPORTED",
  });
  seed(root, "calendar.json", { calendars: [], events: [{ id: "separate" }] });
  data.importLegacy(B, "calendar", summary(data, B, "calendar").fingerprint);
});

test("source modification rejects stale confirmation; valid backup is read without repairing old bytes", (t) => {
  const { root, data } = setup(t);
  const original = seed(root, "calendar.json", "{broken");
  const backup = seed(root, "calendar.json.bak", {
    calendars: [],
    events: [{ id: "from-backup" }],
  });
  const before = summary(data, A, "calendar");
  fs.writeFileSync(original, "{changed broken");
  assert.throws(() => data.importLegacy(A, "calendar", before.fingerprint), {
    code: "LEGACY_SOURCE_CHANGED",
  });
  data.importLegacy(A, "calendar", summary(data, A, "calendar").fingerprint);
  assert.equal(fs.readFileSync(original, "utf8"), "{changed broken");
  assert.deepEqual(fs.readFileSync(data.file(A, "calendar")), fs.readFileSync(backup));
});

test("only pristine default containers may be replaced; customized empty lists and tombstones stay intact", (t) => {
  for (const target of [
    { lists: [{ id: "custom", name: "Work" }], tasks: [], memos: [] },
    { lists: [{ id: "default-inbox", name: "Renamed" }], tasks: [], memos: [] },
    { lists: [], tasks: [], memos: [], deleted: { task: "2026-01-01" } },
    { lists: [], tasks: [], memos: [], custom: 1 },
  ]) {
    const { root, data } = setup(t);
    seed(root, "tasks.json", { lists: [], tasks: [{ id: "old" }], memos: [] });
    const destination = data.file(A, "tasks");
    seed(path.dirname(destination), path.basename(destination), target);
    const before = fs.readFileSync(destination);
    assert.equal(summary(data, A, "tasks").canImport, false);
    assert.throws(() => data.importLegacy(A, "tasks", "x"));
    assert.deepEqual(fs.readFileSync(destination), before);
  }
  const { root, data } = setup(t);
  seed(root, "tasks.json", { lists: [], tasks: [{ id: "old" }], memos: [] });
  const target = data.file(A, "tasks");
  seed(path.dirname(target), path.basename(target), {
    version: 1,
    lists: [{ id: "default-inbox", name: "收件箱", color: "#8e8e93", isInbox: true, sortOrder: 0 }],
    tasks: [],
    memos: [],
    deleted: {},
  });
  data.importLegacy(A, "tasks", summary(data, A, "tasks").fingerprint);
  assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).tasks[0].id, "old");
});

test("notes copy verifies bytes and leaves original and other Principal vault untouched", (t) => {
  const { root, data } = setup(t);
  const original = seed(root, "ShareGPT-Vault/folder/note.md", "original note");
  const attachment = seed(
    root,
    "ShareGPT-Vault/image.bin",
    Buffer.from([1, 2, 3]).toString("binary"),
  );
  const record = summary(data, A, "notes");
  assert.equal(record.fileCount, 2);
  data.importLegacy(A, "notes", record.fingerprint);
  const target = path.join(data.vaultDirectory(A), "folder/note.md");
  fs.writeFileSync(target, "edited copy");
  assert.equal(fs.readFileSync(original, "utf8"), "original note");
  assert.deepEqual(
    fs.readFileSync(path.join(data.vaultDirectory(A), "image.bin")),
    fs.readFileSync(attachment),
  );
  assert.equal(fs.existsSync(data.vaultDirectory(B)), false);
});

test("symlink/junction source and destination cannot escape; selected custom target stays protected", (t) => {
  const { root, data } = setup(t);
  const outside = path.join(root, "external");
  fs.mkdirSync(outside);
  seed(root, "ShareGPT-Vault/normal.md", "normal");
  fs.symlinkSync(
    outside,
    path.join(root, "ShareGPT-Vault/linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.equal(summary(data, A, "notes").canImport, false);
  const other = setup(t);
  seed(other.root, "ShareGPT-Vault/normal.md", "normal");
  seed(other.data.directory(A), "vault-meta.json", { root: outside });
  assert.equal(summary(other.data, A, "notes").reason, "LEGACY_CUSTOM_VAULT");
  const third = setup(t);
  seed(third.root, "tasks.json", { tasks: [{ id: "old" }] });
  fs.mkdirSync(path.join(third.root, "PrincipalData"));
  fs.symlinkSync(
    outside,
    third.data.directory(A),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => third.data.file(A, "tasks"));
});

test("copy failure never publishes target or claims source; retry can succeed", (t) => {
  const { root, data } = setup(t);
  seed(root, "ShareGPT-Vault/note.md", "original");
  const record = summary(data, A, "notes");
  const copy = fs.copyFileSync;
  t.mock.method(fs, "copyFileSync", () => {
    throw new Error("disk full");
  });
  assert.throws(() => data.importLegacy(A, "notes", record.fingerprint), /disk full/);
  assert.equal(fs.existsSync(data.vaultDirectory(A)), false);
  assert.equal(summary(data, B, "notes").canImport, true);
  t.mock.method(fs, "copyFileSync", copy);
  data.importLegacy(A, "notes", record.fingerprint);
});

test("failure after publication resumes the same claim without overwriting edited source or copy", (t) => {
  const { root, data } = setup(t);
  seed(root, "tasks.json", { tasks: [{ id: "old" }] });
  const record = summary(data, A, "tasks");
  const rename = fs.renameSync;
  let ledgerWrites = 0;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (to === data.ledgerFile && ++ledgerWrites === 2) throw new Error("ledger disk failure");
    return rename(from, to);
  });
  assert.throws(() => data.importLegacy(A, "tasks", record.fingerprint), /ledger disk failure/);
  assert.equal(JSON.parse(fs.readFileSync(data.file(A, "tasks"), "utf8")).tasks[0].id, "old");
  t.mock.method(fs, "renameSync", rename);
  const restarted = new PrincipalData(root);
  fs.unlinkSync(path.join(root, "tasks.json"));
  assert.equal(summary(restarted, A, "tasks").reason, "resume");
  assert.equal(restarted.importLegacy(A, "tasks", record.fingerprint).resumed, true);
  assert.equal(summary(restarted, B, "tasks").canImport, false);
});

test("a corrupted copy fails integrity verification before publication or ownership claim", (t) => {
  const { root, data } = setup(t);
  const original = seed(root, "ShareGPT-Vault/note.md", "original");
  const record = summary(data, A, "notes");
  t.mock.method(fs, "copyFileSync", (_source, destination) =>
    fs.writeFileSync(destination, "different"),
  );
  assert.throws(() => data.importLegacy(A, "notes", record.fingerprint), {
    code: "LEGACY_SOURCE_CHANGED",
  });
  assert.equal(fs.readFileSync(original, "utf8"), "original");
  assert.equal(fs.existsSync(data.vaultDirectory(A)), false);
  assert.equal(fs.existsSync(data.ledgerFile), false);
});

test("a corrupted ownership record is rejected and cannot assign old data to another account", (t) => {
  const { root, data } = setup(t);
  seed(root, "tasks.json", { tasks: [{ id: "old" }] });
  fs.writeFileSync(
    data.ledgerFile,
    JSON.stringify({
      version: 1,
      categories: {
        tasks: {
          principalId: "",
          state: "done",
          fingerprint: "a".repeat(64),
          targetFingerprint: "b".repeat(64),
        },
      },
    }),
  );
  assert.throws(() => data.inspectLegacy(B), { code: "LOCAL_STORE_UNAVAILABLE" });
  assert.equal(fs.existsSync(data.file(B, "tasks")), false);
});

test("chat and focus categories preserve original JSON structure with independent confirmation", (t) => {
  const { root, data } = setup(t);
  const chat = seed(root, "chat_history.json", {
    version: 1,
    conversations: { "team\\0room": [{ id: "legacy-message", text: "old" }] },
  });
  const focus = seed(root, "focus.json", {
    version: 1,
    sessions: [{ id: "session-old" }],
    settings: { focusMin: 40 },
  });
  data.importLegacy(A, "chat", summary(data, A, "chat").groups[0].fingerprint, { group: "" });
  data.importLegacy(A, "focus", summary(data, A, "focus").fingerprint);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(data.file(A, "chat"), "utf8")),
    JSON.parse(fs.readFileSync(chat, "utf8")),
  );
  assert.deepEqual(fs.readFileSync(data.file(A, "focus")), fs.readFileSync(focus));
});

test("chat source groups require explicit selection and keep other groups available to their owners", (t) => {
  const { root, data } = setup(t);
  const source = seed(root, "chat_history.json", {
    version: 1,
    conversations: {
      "https://team-a.example\0room": [{ id: "A-message" }],
      "https://team-b.example\0room": [{ id: "B-message" }],
      unlabeled: [{ id: "unlabeled-message" }],
    },
  });
  const before = fs.readFileSync(source);
  const choose = (principal, group) =>
    summary(data, principal, "chat").groups.find((entry) => entry.group === group);
  assert.equal(summary(data, A, "chat").groups.length, 3);
  assert.throws(
    () => data.importLegacy(A, "chat", choose(A, "https://team-a.example").fingerprint),
    { code: "LEGACY_CHAT_GROUP_REQUIRED" },
  );
  assert.throws(
    () =>
      data.importLegacy(A, "chat", choose(A, "https://team-a.example").fingerprint, {
        group: "https://team-b.example",
      }),
    { code: "LEGACY_SOURCE_CHANGED" },
  );
  data.importLegacy(A, "chat", choose(A, "https://team-a.example").fingerprint, {
    group: "https://team-a.example",
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(data.file(A, "chat"), "utf8")).conversations, {
    room: [{ id: "A-message" }],
  });
  assert.equal(choose(B, "https://team-a.example").canImport, false);
  assert.equal(choose(B, "https://team-b.example").canImport, true);
  data.importLegacy(B, "chat", choose(B, "https://team-b.example").fingerprint, {
    group: "https://team-b.example",
  });
  data.importLegacy("local-device", "chat", choose("local-device", "").fingerprint, { group: "" });
  assert.deepEqual(fs.readFileSync(source), before);
  assert.deepEqual(JSON.parse(fs.readFileSync(data.file(B, "chat"), "utf8")).conversations, {
    room: [{ id: "B-message" }],
  });
});
