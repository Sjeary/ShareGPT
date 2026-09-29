const test = require("node:test");
const assert = require("node:assert/strict");
const { rendererStoreHarness, deferred } = require("./helpers/rendererStoreHarness.cjs");

async function setup(overrides) {
  const app = rendererStoreHarness(overrides);
  app.calendar = app.load("store/useCalendarStore.ts").useCalendarStore;
  app.tasks = app.load("store/useTasksStore.ts").useTasksStore;
  app.sync = app.load("lib/integrations.ts").syncTaskToCalendar;
  await app.tasks.getState().init();
  app.task = app.tasks.getState().addTask({ title: "Due task", dueDate: "2026-01-03" });
  return app;
}

test("task integration initializes unopened calendar and persists one event before reporting success", async () => {
  const app = await setup({
    api: {
      loadCalendar: async () => ({
        calendars: [{ id: "existing", name: "Personal", color: "#123456" }],
        events: [],
      }),
    },
  });
  const result = await Promise.all([app.sync(app.task.id), app.sync(app.task.id)]);
  assert.equal(result[0], "synced");
  assert.equal(app.calendar.getState().events.length, 1);
  const id = app.tasks.getState().tasks[0].calendarEventId;
  assert.equal(app.saved.calendar.at(-1).events[0].id, id);
  assert.equal(app.saved.tasks.at(-1).tasks[0].calendarEventId, id);
  app.api.loadCalendar = async () => app.saved.calendar.at(-1);
  app.calendar.getState().resetForPrincipal();
  await app.calendar.getState().init();
  assert.equal(app.calendar.getState().events[0].id, id);
  assert.equal(await app.sync(app.task.id), "updated");
  assert.equal(app.calendar.getState().events.length, 1);
});

test("task integration refuses failed calendar reads without creating dangling links", async () => {
  const app = await setup({
    api: {
      loadCalendar: async () => {
        throw new Error("unreadable");
      },
    },
  });
  await assert.rejects(app.sync(app.task.id), /无法读取/);
  assert.equal(app.calendar.getState().events.length, 0);
  assert.equal(Boolean(app.tasks.getState().tasks[0].calendarEventId), false);
  assert.equal(app.saved.calendar.length, 0);
});

test("switching accounts during calendar initialization cancels task integration", async () => {
  const pending = deferred();
  const app = await setup({ api: { loadCalendar: () => pending.promise } });
  const operation = app.sync(app.task.id);
  await app.settle();
  app.load("lib/settingsPrincipalRuntime.ts").settingsPrincipalRuntime.activate("B", 2);
  app.calendar.getState().resetForPrincipal();
  app.tasks.getState().resetForPrincipal();
  pending.resolve(null);
  await assert.rejects(operation, { name: "StaleSettingsPrincipalError" });
  assert.equal(app.saved.calendar.length, 0);
  assert.equal(app.tasks.getState().tasks.length, 0);
});

test("task link is not changed or saved while calendar write is pending or has failed", async () => {
  const pending = deferred();
  const app = await setup({
    api: {
      loadCalendar: async () => ({
        calendars: [{ id: "existing", name: "Personal", color: "#123456" }],
        events: [],
      }),
      saveCalendar: () => pending.promise,
    },
  });
  await app.tasks.getState().flushPending();
  app.saved.tasks.length = 0;
  const operation = app.sync(app.task.id);
  await app.settle();
  await app.tasks.getState().flushPending();
  assert.equal(Boolean(app.tasks.getState().tasks[0].calendarEventId), false);
  assert.equal(app.saved.tasks.length, 0);
  pending.reject(new Error("calendar write failed"));
  await assert.rejects(operation, /calendar write failed/);
  await app.tasks.getState().flushPending();
  assert.equal(Boolean(app.tasks.getState().tasks[0].calendarEventId), false);
  assert.equal(app.saved.tasks.length, 0);
  app.api.saveCalendar = async (data) => {
    app.saved.calendar.push(data);
    return data;
  };
  await app.sync(app.task.id);
  assert.equal(app.calendar.getState().events.length, 1, "retry must reuse the failed event");
  assert.equal(
    app.saved.tasks.at(-1).tasks[0].calendarEventId,
    app.saved.calendar.at(-1).events[0].id,
  );
});
