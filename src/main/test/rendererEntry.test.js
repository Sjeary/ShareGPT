const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRendererEntry, resolveRendererEntry } = require("../rendererEntry");

test("development may use the renderer-next server without a legacy renderer flag", () => {
  assert.deepEqual(
    resolveRendererEntry({
      builtFile: "/missing/index.html",
      devUrl: "http://127.0.0.1:5173/",
      devPath: "profile.html",
      query: { username: "Alice" },
      existsSync: () => false,
    }),
    {
      type: "url",
      target: "http://127.0.0.1:5173/profile.html?username=Alice",
    },
  );
});

test("production requires the renderer-next build instead of loading a second renderer", () => {
  assert.throws(
    () =>
      resolveRendererEntry({
        builtFile: "/missing/index.html",
        isPackaged: true,
        existsSync: () => false,
      }),
    { code: "RENDERER_BUILD_MISSING" },
  );
  assert.deepEqual(
    resolveRendererEntry({
      builtFile: "/app/renderer-next/dist/index.html",
      isPackaged: true,
      existsSync: () => true,
    }),
    {
      type: "file",
      target: "/app/renderer-next/dist/index.html",
      query: {},
    },
  );
});

test("resolved renderer entries invoke only their selected loader", async () => {
  const calls = [];
  const window = {
    loadFile: async (...args) => calls.push(["file", ...args]),
    loadURL: async (...args) => calls.push(["url", ...args]),
  };
  await loadRendererEntry(window, {
    type: "file",
    target: "/app/renderer-next/dist/profile.html",
    query: { username: "Alice" },
  });
  assert.deepEqual(calls, [
    ["file", "/app/renderer-next/dist/profile.html", { query: { username: "Alice" } }],
  ]);
});
