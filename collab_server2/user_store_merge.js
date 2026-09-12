const COLLECTIONS = {
  calendar: ["calendars", "events"],
  tasks: ["lists", "tasks", "memos"],
};

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// The revision check remains the write authority. Tombstones are additive data:
// old clients may omit them, but cannot restore IDs explicitly deleted by a new client.
function mergeUserStoreData(kind, previous, incoming) {
  const collections = COLLECTIONS[kind];
  if (!collections || !incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return incoming;
  }
  const deleted = {};
  for (const collection of collections) {
    const entries = new Map();
    for (const source of [previous, incoming]) {
      for (const [id, rawTime] of Object.entries(
        object(object(object(source).deleted)[collection]),
      )) {
        if (!id || typeof rawTime !== "string") continue;
        const timestamp = Date.parse(rawTime);
        if (!Number.isFinite(timestamp)) continue;
        const previousTime = entries.get(id);
        if (!previousTime || timestamp > Date.parse(previousTime)) {
          entries.set(id, new Date(timestamp).toISOString());
        }
      }
    }
    if (entries.size) deleted[collection] = Object.fromEntries(entries);
  }
  if (!Object.keys(deleted).length) return incoming;
  const next = { ...object(previous), ...incoming, deleted };
  const isDeleted = (collection, id) =>
    typeof id === "string" && Object.hasOwn(deleted[collection] || {}, id);
  for (const collection of collections) {
    if (!Array.isArray(next[collection])) continue;
    next[collection] = next[collection].filter((item) => {
      if (isDeleted(collection, item?.id)) return false;
      if (collection === "events" && isDeleted("calendars", item?.calendarId)) return false;
      return true;
    });
  }
  if (kind === "tasks" && Array.isArray(next.tasks) && Array.isArray(next.lists)) {
    const fallback = next.lists.find((list) => list?.isInbox)?.id || next.lists[0]?.id;
    if (fallback) {
      next.tasks = next.tasks.map((task) =>
        isDeleted("lists", task?.listId) ? { ...task, listId: fallback } : task,
      );
    }
  }
  return next;
}

module.exports = { mergeUserStoreData };
