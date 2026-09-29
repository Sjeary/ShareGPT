const test = require("node:test");
const assert = require("node:assert/strict");
const { rendererStoreHarness, deferred } = require("./helpers/rendererStoreHarness.cjs");

const event = (id) => ({
  id,
  title: id,
  start: "2026-01-02T12:00:00Z",
  end: "2026-01-02T13:00:00Z",
  allDay: false,
  attendees: [],
  organizer: id,
  subnetKey: "team",
  createdBy: id,
  createdAt: "",
  updatedAt: "",
});
const draft = {
  title: "new",
  start: event("").start,
  end: event("").end,
  allDay: false,
  attendees: [],
};
const response = (data, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => data,
  text: async () => "fixture failure",
});
function setup(fetch) {
  const app = rendererStoreHarness({ fetch });
  const runtime = app.load("lib/settingsPrincipalRuntime.ts").settingsPrincipalRuntime;
  const chat = app.load("store/useChatStore.ts").useChatStore;
  const store = app.load("store/useTeamCalendarStore.ts").useTeamCalendarStore;
  const service = app.load("lib/teamCalendarClient.ts");
  let generation = 0;
  const activate = (id, local = false) => {
    runtime.activate(id, ++generation);
    chat.getState().setIdentity({
      serverUrl: local ? "" : `https://fixture.invalid/${id}`,
      token: local ? "" : id,
      username: id,
      displayName: id,
    });
    store.getState().reset();
    return service.createTeamCalendarClient();
  };
  return { ...app, runtime, chat, store, service, activate };
}

test("late team-calendar reads and errors cannot populate or change another principal", async () => {
  for (const fail of [false, true]) {
    const pending = deferred();
    const app = setup(() => pending.promise);
    const a = app.activate("A");
    const reload = a.reload();
    await app.settle();
    app.activate("B");
    if (fail) pending.reject(new Error("old failure"));
    else pending.resolve(response({ events: [event("A")] }));
    await reload;
    assert.equal(Object.keys(app.store.getState().events).length, 0);
    assert.equal(app.store.getState().loadError, "");
    assert.equal(app.storage.has(app.service.teamCalendarCacheKey("B")), false);
  }
});

test("503 retains only the same principal snapshot and A/B/A restores scoped caches", async () => {
  let status = 200;
  let result = "A";
  const app = setup(async () => response({ events: [event(result)] }, status));
  app.storage.set("team-calendar:local-events", JSON.stringify([event("unowned-legacy")]));
  await app.activate("A").reload();
  status = 503;
  await app.service.createTeamCalendarClient().reload();
  assert.equal(app.store.getState().events.A.id, "A");
  assert.match(app.store.getState().loadError, /503/);
  await app.activate("B").reload();
  assert.equal(Object.keys(app.store.getState().events).length, 0);
  assert.notEqual(app.store.getState().source, "local");
  status = 200;
  result = "B";
  await app.service.createTeamCalendarClient().reload();
  assert.equal(app.store.getState().events.B.id, "B");
  status = 503;
  await app.activate("A").reload();
  assert.deepEqual(Object.keys(app.store.getState().events), ["A"]);
  assert.match(app.store.getState().loadError, /503/);
  assert.equal(
    app.storage.has("team-calendar:local-events"),
    true,
    "legacy material is preserved without automatic attribution",
  );
});

for (const action of ["createEvent", "updateEvent", "deleteEvent", "setRsvp", "shareEventToTeam"]) {
  test(`${action} captures credentials and discards a response after an account switch`, async () => {
    const pending = deferred();
    const calls = [];
    const app = setup((url, init) => {
      calls.push([url, init]);
      return pending.promise;
    });
    const a = app.activate("A");
    const operation =
      action === "shareEventToTeam"
        ? app.load("lib/integrations.ts").shareEventToTeam(draft)
        : action === "createEvent"
          ? a.createEvent(draft)
          : action === "updateEvent"
            ? a.updateEvent("original", { title: "edited" })
            : action === "deleteEvent"
              ? a.deleteEvent("original")
              : a.setRsvp("original", "accept");
    await app.settle();
    app.activate("B");
    app.store.getState().upsert(event("original"));
    pending.resolve(response({ event: event("from-A") }));
    await assert.rejects(operation, { name: "StaleSettingsPrincipalError" });
    assert.equal(calls[0][0].startsWith("https://fixture.invalid/A/"), true);
    assert.equal(calls[0][1].headers.Authorization, "Bearer A");
    assert.deepEqual(Object.keys(app.store.getState().events), ["original"]);
    assert.equal(app.storage.size, 0);
  });
}

test("late response bodies and stale A callbacks are invalid even after returning A/B/A", async () => {
  const body = deferred();
  const app = setup(async () => ({ ...response({}), json: () => body.promise }));
  const firstA = app.activate("A");
  const operation = firstA.createEvent(draft);
  await app.settle();
  app.activate("B");
  app.activate("A");
  body.resolve({ event: event("old-A") });
  await assert.rejects(operation, { name: "StaleSettingsPrincipalError" });
  firstA.receive({ type: "calendar_event_created", event: event("old-broadcast") });
  assert.equal(Object.keys(app.store.getState().events).length, 0);
});

test("local creation persists without a mounted panel and restores only its principal", async () => {
  const app = setup(() => {
    throw new Error("offline must never fetch");
  });
  const a = app.activate("personal-A", true);
  const created = await app.load("lib/integrations.ts").shareEventToTeam(draft);
  assert.equal(Object.keys(app.store.getState().events).length, 1);
  await app.activate("personal-B", true).reload();
  assert.equal(Object.keys(app.store.getState().events).length, 0);
  const again = app.activate("personal-A", true);
  await again.reload();
  assert.equal(app.store.getState().events[created.id].title, draft.title);
  await again.updateEvent(created.id, { title: "edited" });
  await again.setRsvp(created.id, "tentative");
  assert.equal(app.store.getState().events[created.id].attendees[0].rsvp, "tentative");
  await assert.rejects(a.deleteEvent(created.id), { name: "StaleSettingsPrincipalError" });
  await again.deleteEvent(created.id);
  assert.equal(
    JSON.parse(app.storage.get(app.service.teamCalendarCacheKey("personal-A"))).length,
    0,
  );
});

test("unreadable local calendar stays untouched and cannot become an empty writable calendar", async () => {
  const app = setup();
  const client = app.activate("personal", true);
  const key = app.service.teamCalendarCacheKey("personal");
  app.storage.set(key, "{broken");
  await client.reload();
  assert.ok(app.store.getState().loadError);
  await assert.rejects(client.createEvent(draft));
  assert.equal(app.storage.get(key), "{broken");
  assert.equal(Object.keys(app.store.getState().events).length, 0);
});

test("late network failures are cancelled quietly after switching accounts", async () => {
  const pending = deferred();
  const app = setup(() => pending.promise);
  const old = app.activate("A");
  const operation = old.createEvent(draft);
  await app.settle();
  app.activate("B");
  pending.reject(new Error("connection failed for A"));
  await assert.rejects(operation, { name: "StaleSettingsPrincipalError" });
  assert.equal(Object.keys(app.store.getState().events).length, 0);
});

test("sharing before opening the team panel preserves the same-account cached snapshot", async () => {
  const app = setup(async () => response({ event: event("created") }));
  app.activate("A");
  const key = app.service.teamCalendarCacheKey("A");
  app.storage.set(key, JSON.stringify([event("previous")]));
  await app.load("lib/integrations.ts").shareEventToTeam(draft);
  assert.deepEqual(Object.keys(app.store.getState().events), ["previous", "created"]);
  assert.equal(JSON.parse(app.storage.get(key)).length, 2);
});

for (const mutation of ["create", "delete", "broadcast", "share"]) {
  test(`a delayed GET cannot overwrite a newer ${mutation} result from the same principal`, async () => {
    const pending = deferred();
    const app = setup((_url, init) =>
      init.method === "GET" ? pending.promise : Promise.resolve(response({ event: event("new") })),
    );
    const client = app.activate("A");
    app.storage.set(app.service.teamCalendarCacheKey("A"), JSON.stringify([event("old")]));
    const reload = client.reload();
    await app.settle();
    if (mutation === "create") await client.createEvent(draft);
    if (mutation === "share") await app.load("lib/integrations.ts").shareEventToTeam(draft);
    if (mutation === "delete") await client.deleteEvent("old");
    if (mutation === "broadcast")
      client.receive({ type: "calendar_event_created", event: event("new") });
    const latest = JSON.stringify(app.store.getState().events);
    pending.resolve(response({ events: [event("old")] }));
    await reload;
    assert.equal(JSON.stringify(app.store.getState().events), latest);
    assert.equal(app.store.getState().loading, false);
  });
}

test("the team hook hides old-account events and status before its first effect can reset the store", () => {
  const { createRequire } = require("node:module");
  const path = require("node:path");
  const requireRenderer = createRequire(
    path.resolve(__dirname, "../../renderer-next/package.json"),
  );
  const { createStore } = requireRenderer("zustand/vanilla");
  const app = rendererStoreHarness({
    modules: {
      zustand: {
        create(initializer) {
          const store = createStore(initializer);
          return Object.assign((selector) => selector(store.getState()), store);
        },
      },
      react: { useMemo: (factory) => factory(), useEffect() {} },
    },
  });
  const runtime = app.load("lib/settingsPrincipalRuntime.ts").settingsPrincipalRuntime;
  const store = app.load("store/useTeamCalendarStore.ts").useTeamCalendarStore;
  const owner = runtime.activate("A", 1);
  store.setState({
    owner,
    events: { A: event("A") },
    source: "server",
    loadError: "A error",
    editorTarget: "A",
  });
  runtime.activate("B", 2);
  const hook = app.load("hooks/useTeamCalendar.ts").useTeamCalendar();
  assert.equal(hook.ownsSnapshot, false);
  assert.equal(hook.events.length, 0);
  assert.equal(hook.loadError, "");
  assert.equal(hook.source, "loading");
  runtime.activate("A", 3);
  assert.equal(app.load("hooks/useTeamCalendar.ts").useTeamCalendar().events.length, 0);
});
