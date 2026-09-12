const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeUserStoreData } = require("../user_store_merge");

const deletedAt = "2026-01-02T03:04:05.000Z";
test("unchanged legacy stores retain their original replacement contract", () => {
  const oldData = { version: 1, events: [{ id: "old" }] };
  const incoming = { version: 1, events: [{ id: "new" }] };
  assert.equal(mergeUserStoreData("calendar", oldData, incoming), incoming);
  assert.equal(
    mergeUserStoreData("notes", { deleted: { events: { new: deletedAt } } }, incoming),
    incoming,
  );
});

test("old-client writes cannot resurrect deleted events or discard their tombstones", () => {
  const previous = {
    version: 1,
    events: [],
    futureOption: "retained",
    deleted: { events: { removed: deletedAt } },
  };
  const incoming = { version: 1, events: [{ id: "removed" }, { id: "new", title: "new content" }] };
  const next = mergeUserStoreData("calendar", previous, incoming);
  assert.deepEqual(next.events, [{ id: "new", title: "new content" }]);
  assert.deepEqual(next.deleted, previous.deleted);
  assert.equal(next.futureOption, "retained");
  assert.equal(incoming.events.length, 2);
});

test("calendar and task deletions merge monotonically and suppress children of deleted containers", () => {
  const calendar = mergeUserStoreData(
    "calendar",
    { deleted: { events: { first: deletedAt } } },
    {
      calendars: [{ id: "removed-calendar" }],
      events: [{ id: "first" }, { id: "child", calendarId: "removed-calendar" }, { id: "kept" }],
      deleted: { calendars: { "removed-calendar": deletedAt }, events: { second: deletedAt } },
    },
  );
  assert.deepEqual(calendar.events, [{ id: "kept" }]);
  assert.deepEqual(calendar.calendars, []);
  assert.deepEqual(Object.keys(calendar.deleted.events), ["first", "second"]);
  const tasks = mergeUserStoreData(
    "tasks",
    { deleted: { lists: { removed: deletedAt }, memos: { memo: deletedAt } } },
    {
      lists: [{ id: "removed" }, { id: "inbox", isInbox: true }],
      tasks: [{ id: "child", listId: "removed" }, { id: "kept" }],
      memos: [{ id: "memo" }],
    },
  );
  assert.deepEqual(tasks.lists, [{ id: "inbox", isInbox: true }]);
  assert.deepEqual(tasks.tasks, [{ id: "child", listId: "inbox" }, { id: "kept" }]);
  assert.deepEqual(tasks.memos, []);
});

test("invalid deletion timestamps do not delete records and special IDs stay ordinary keys", () => {
  const incoming = JSON.parse(
    '{"events":[{"id":"__proto__"},{"id":"kept"}],"deleted":{"events":{"__proto__":"2026-01-02T03:04:05.000Z","kept":"invalid"}}}',
  );
  const next = mergeUserStoreData("calendar", {}, incoming);
  assert.deepEqual(next.events, [{ id: "kept" }]);
  assert.equal(Object.hasOwn(next.deleted.events, "__proto__"), true);
  assert.equal(Object.getPrototypeOf(next.deleted.events), Object.prototype);
});
