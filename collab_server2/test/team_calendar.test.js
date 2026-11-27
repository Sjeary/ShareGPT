const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createTeamCalendarHandler } = require("../team_calendar");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-team-calendar-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "calendars.json");
  const sessions = new Map([
    ["A", { username: "Alice", displayName: "Alice", subnetKey: "team-a" }],
    ["B", { username: "Bob", displayName: "Bob", subnetKey: "team-a" }],
    ["C", { username: "alice", displayName: "Other team", subnetKey: "team-b" }],
  ]);
  const events = [];
  let read = async (req) => JSON.stringify(req.payload || {});
  const sendText = (res, status, body) => Object.assign(res, { status, body });
  const handler = createTeamCalendarHandler({
    file,
    nowIso: () => new Date().toISOString(),
    safeText: (value) => String(value || "").trim(),
    sessionForRequest: (req) => sessions.get(req.token),
    requireCurrentSession: (req, res, session) => {
      if (sessions.get(req.token) === session) return true;
      sendText(res, 401, "登录已失效");
      return false;
    },
    readBody: (req) => read(req),
    safeParseJson: JSON.parse,
    sendText,
    sendJson: sendText,
    broadcastToSubnet: (subnet, event) => events.push({ subnet, event }),
  });
  const request = async (method, suffix = "", payload = {}, token = "A") => {
    const res = {};
    const handled = await handler(
      { method, token, payload },
      res,
      "/api/team-calendar/events" + suffix,
    );
    assert.equal(handled, true);
    return res;
  };
  return {
    file,
    directory,
    sessions,
    events,
    request,
    setRead: (fn) => {
      read = fn;
    },
  };
}

const newEvent = {
  title: "Kept event",
  start: "2026-11-22T12:00:00Z",
  attendees: [{ username: "Alice" }, { username: "Alice", rsvp: "accept" }],
};

test("calendar preserves existing event format, case-sensitive membership and server-owned identity", async (t) => {
  const f = fixture(t);
  const created = await f.request("POST", "", {
    ...newEvent,
    subnetKey: "team-b",
    organizer: "forged",
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.event.organizer, "Alice");
  assert.equal(created.body.event.subnetKey, "team-a");
  assert.equal(created.body.event.attendees.length, 1);
  assert.equal(created.body.event.attendees[0].rsvp, "accept");
  assert.equal((await f.request("GET")).body.events.length, 1);
  assert.deepEqual((await f.request("GET", "", {}, "C")).body.events, []);
  assert.equal(JSON.parse(fs.readFileSync(f.file, "utf8")).events[0].id, created.body.event.id);
});

test("calendar enforces organizer-only editing and deletion while keeping member RSVP", async (t) => {
  const f = fixture(t);
  const id = (await f.request("POST", "", newEvent)).body.event.id;
  const rsvp = await f.request("POST", `/${id}/rsvp`, { status: "tentative" }, "B");
  assert.equal(rsvp.body.event.attendees.find((a) => a.username === "Bob").rsvp, "tentative");
  const deniedEdit = await f.request(
    "PATCH",
    `/${id}`,
    { title: "Unauthorized edit", organizer: "Bob", subnetKey: "team-b" },
    "B",
  );
  assert.equal(deniedEdit.status, 403);
  assert.equal((await f.request("GET")).body.events[0].title, "Kept event");
  const organizerEdit = await f.request(
    "PATCH",
    `/${id}`,
    { title: "Edited by organizer", organizer: "Bob", subnetKey: "team-b" },
    "A",
  );
  assert.equal(organizerEdit.status, 200);
  assert.equal(organizerEdit.body.event.title, "Edited by organizer");
  assert.equal(organizerEdit.body.event.organizer, "Alice");
  assert.equal((await f.request("DELETE", `/${id}`, {}, "B")).status, 403);
  assert.equal((await f.request("PATCH", `/${id}`, { title: "Other team" }, "C")).status, 404);
  assert.equal((await f.request("DELETE", `/${id}`)).status, 200);
  assert.deepEqual((await f.request("GET")).body.events, []);
  assert.ok(f.events.every((event) => event.subnet === "team-a"));
});

for (const contents of ["{broken", '{"events":"unreadable"}'])
  test(`corrupt calendar data cannot become an authoritative empty store: ${contents}`, async (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.file, contents);
    assert.equal((await f.request("GET")).status, 500);
    assert.equal((await f.request("POST", "", newEvent)).status, 500);
    assert.equal(fs.readFileSync(f.file, "utf8"), contents);
    assert.equal(f.events.length, 0);
  });

test("calendar recovers the previous valid snapshot while retaining the damaged original", async (t) => {
  const f = fixture(t);
  const id = (await f.request("POST", "", newEvent)).body.event.id;
  await f.request("PATCH", `/${id}`, { title: "Later" });
  const previous = fs.readFileSync(f.file + ".backup", "utf8");
  fs.writeFileSync(f.file, "{damaged latest");
  const recovered = await f.request("GET");
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.events[0].title, "Kept event");
  assert.equal(fs.readFileSync(f.file, "utf8"), previous);
  const damaged = fs.readdirSync(f.directory).find((name) => name.includes(".corrupt-"));
  assert.equal(fs.readFileSync(path.join(f.directory, damaged), "utf8"), "{damaged latest");
});

test("a revoked calendar write stops after awaiting its body and preserves the previous file", async (t) => {
  const f = fixture(t);
  await f.request("POST", "", newEvent);
  const before = fs.readFileSync(f.file, "utf8");
  let release;
  f.setRead(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = f.request("POST", "", { ...newEvent, title: "revoked" });
  f.sessions.delete("A");
  release(JSON.stringify(newEvent));
  assert.equal((await pending).status, 401);
  assert.equal(fs.readFileSync(f.file, "utf8"), before);
});
