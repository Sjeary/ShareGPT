const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createFixtureServer,
  launchCase,
  loginThroughForm,
  readWorkspaceScope,
} = require("./verify-collab-login-compatibility");
const screenshotDirectory = process.env.SHAREGPT_ACCEPTANCE_SCREENSHOTS;

function seedLegacy(directory) {
  const files = {
    "calendar.json": JSON.stringify({
      version: 1,
      calendars: [{ id: "old-calendar", name: "Legacy", color: "#123456" }],
      events: [],
    }),
    "tasks.json": JSON.stringify({
      version: 1,
      lists: [{ id: "old-list", name: "Legacy" }],
      tasks: [],
      memos: [],
    }),
    "focus.json": JSON.stringify({
      version: 1,
      sessions: [{ id: "legacy-focus" }],
      settings: null,
    }),
    "chat_history.json": JSON.stringify({
      version: 1,
      conversations: {
        "subnet:global": [
          {
            id: "legacy-chat",
            text: "legacy message",
            from: "fixture",
            timestamp: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    }),
    "vault-meta.json": JSON.stringify({ root: path.join(directory, "ShareGPT-Vault") }),
    "ShareGPT-Vault/legacy.md": "# Legacy\nSynthetic local data must remain untouched.\n",
  };
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(directory, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return Object.fromEntries(
    Object.keys(files).map((name) => [name, hash(path.join(directory, name))]),
  );
}

function hash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function verifyOriginal(directory, original) {
  for (const [name, expected] of Object.entries(original))
    assert.equal(hash(path.join(directory, name)), expected, `legacy source changed: ${name}`);
}

async function verifyLegacyPreview(window) {
  const preview = await window.evaluate(() => window.api.inspectLegacyUserData());
  const categories = Array.isArray(preview) ? preview : preview.categories;
  for (const category of ["calendar", "tasks", "focus", "chat", "notes"]) {
    const entry = categories.find((item) => item.category === category);
    assert.ok(entry, `legacy preview omitted ${category}`);
    assert.equal(entry.available, true, `legacy ${category} source should be discoverable`);
    assert.ok(entry.bytes > 0);
  }
  return preview;
}

async function importLegacyThroughUi(window, profileDirectory, original) {
  await window.locator('[data-tour="nav-account"]').click();
  await window.getByTestId("legacy-data-open").click();
  const dialog = window.getByRole("dialog");
  if (screenshotDirectory) {
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    await dialog.screenshot({ path: path.join(screenshotDirectory, "legacy-data-list.png") });
  }
  for (const category of ["calendar", "tasks", "focus", "chat", "notes"]) {
    const select = dialog.getByTestId(`legacy-data-${category}`).first();
    await select.waitFor({ state: "visible" });
    assert.equal(
      await select.isEnabled(),
      true,
      `${category} should be available for explicit import`,
    );
    await select.click();
    const confirm = dialog.getByRole("button", { name: "确认接续", exact: true });
    assert.equal(await confirm.isEnabled(), false, "import needs explicit ownership confirmation");
    await dialog.getByRole("checkbox").check();
    if (screenshotDirectory && category === "calendar")
      await dialog.screenshot({
        path: path.join(screenshotDirectory, "legacy-data-confirmation.png"),
      });
    await confirm.click();
    await dialog.getByTestId(`legacy-data-${category}`).first().waitFor({ state: "visible" });
    assert.equal(
      await dialog.getByTestId(`legacy-data-${category}`).first().isEnabled(),
      false,
      "completed import should not overwrite its destination again",
    );
    verifyOriginal(profileDirectory, original);
  }
  await window.keyboard.press("Escape");
  const imported = await readData(window);
  assert.equal(imported.calendar.calendars[0]?.id, "old-calendar");
  assert.equal(imported.tasks.lists[0]?.id, "old-list");
  assert.ok(imported.notes.some((note) => note.path === "legacy.md"));
  assert.ok(
    Object.values(imported.chat.conversations ?? {})
      .flat()
      .some((message) => message.id === "legacy-chat"),
  );
}

async function readData(window) {
  return window.evaluate(async () => {
    const scope = await window.api.getSettingsPrincipal();
    return {
      scope,
      calendar: await window.api.loadCalendar(scope),
      tasks: await window.api.loadTasks(scope),
      focus: await window.api.loadFocus(scope),
      chat: await window.api.loadChatHistory(scope),
      notes: await window.api.vault.readAll(scope),
      vaultRoot: await window.api.vault.getRoot(scope),
    };
  });
}

async function writeData(window, label) {
  await window.evaluate(async (marker) => {
    const scope = await window.api.getSettingsPrincipal();
    const timestamp = "2026-01-01T00:00:00.000Z";
    await window.api.saveCalendar(
      {
        version: 1,
        calendars: [
          {
            id: `calendar-${marker}`,
            name: marker,
            color: "#123456",
            isDefault: true,
            visible: true,
          },
        ],
        events: [],
      },
      scope,
    );
    await window.api.saveTasks(
      {
        version: 1,
        lists: [
          { id: `list-${marker}`, name: marker, color: "#123456", isInbox: true, sortOrder: 0 },
        ],
        tasks: [],
        memos: [
          {
            id: `memo-${marker}`,
            body: marker,
            color: "#fff3bf",
            pinned: false,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      },
      scope,
    );
    await window.api.saveFocus(
      { version: 1, sessions: [{ id: `focus-${marker}`, duration: 25 }], settings: null },
      scope,
    );
    await window.api.vault.write("scope-marker.md", marker, scope);
  }, label);
}

function assertMarker(data, label) {
  assert.equal(data.calendar.calendars[0]?.name, label);
  assert.equal(data.tasks.memos[0]?.body, label);
  assert.equal(data.focus.sessions[0]?.id, `focus-${label}`);
  const messages = Object.values(data.chat.conversations ?? {}).flat();
  if (label === "local")
    assert.equal(messages.length, 0, "personal workspace has no team chat history");
  else assert.ok(messages.some((message) => message.text === label));
  assert.ok(data.notes.some((note) => note.path === "scope-marker.md" && note.content === label));
}

function assertUnassigned(data) {
  assert.equal(
    data.calendar.calendars.some((calendar) => calendar.id === "old-calendar"),
    false,
  );
  assert.equal(
    data.tasks.lists.some((list) => list.id === "old-list"),
    false,
  );
  assert.equal(
    data.focus.sessions.some((session) => session.id === "legacy-focus"),
    false,
  );
  assert.equal(
    Object.values(data.chat.conversations ?? {})
      .flat()
      .some((message) => message.id === "legacy-chat"),
    false,
  );
  assert.equal(
    data.notes.some((note) => note.path === "legacy.md"),
    false,
  );
}

async function logout(window) {
  await window.locator('[data-tour="nav-account"]').click();
  await window.getByRole("button", { name: "退出登录", exact: true }).click();
  await window.locator("#account-server").waitFor({ state: "visible" });
}

async function receiveChat(fixture, window, username, label) {
  const sent = fixture.sendUserMessage(username, {
    id: `chat-${label}`,
    type: "chat",
    scope: "subnet",
    subnetKey: "global",
    subnetLabel: "fixture",
    roomScope: "fixture",
    from: "synthetic-peer",
    username: "synthetic-peer",
    displayName: "Fixture peer",
    text: label,
    timestamp: new Date().toISOString(),
    readBy: [],
  });
  assert.equal(sent, true, "fixture user should have an active socket");
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const chat = await window.evaluate(() => window.api.loadChatHistory());
    if (
      Object.values(chat.conversations ?? {})
        .flat()
        .some((message) => message.id === `chat-${label}`)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("received chat was not persisted by the renderer");
}

async function cookieSentinels(electronApp, scope, expected, storageUrl, write = false) {
  return electronApp.evaluate(
    async ({ session, BrowserWindow }, input) => {
      const values = {};
      for (const kind of ["gpt", "claude", "gemini"]) {
        const partition = input.scope[`${kind}Partition`];
        const target = session.fromPartition(partition);
        if (input.write) {
          await target.cookies.set({
            url: "https://example.test",
            name: "scope-proof",
            value: input.expected,
            expirationDate: Math.floor(Date.now() / 1000) + 86400,
          });
          await target.cookies.flushStore();
        }
        const cookie =
          (await target.cookies.get({ url: "https://example.test", name: "scope-proof" }))[0]
            ?.value || "";
        const storageWindow = new BrowserWindow({
          show: false,
          webPreferences: {
            partition,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        try {
          await storageWindow.loadURL(input.storageUrl);
          if (input.write)
            await storageWindow.webContents.executeJavaScript(
              `localStorage.setItem('scope-proof', ${JSON.stringify(input.expected)})`,
            );
          const localStorage = await storageWindow.webContents.executeJavaScript(
            "localStorage.getItem('scope-proof')",
          );
          values[kind] = { cookie, localStorage };
        } finally {
          storageWindow.destroy();
        }
        target.flushStorageData();
      }
      return values;
    },
    { scope, expected, write, storageUrl },
  );
}

async function main() {
  const fixture = await createFixtureServer();
  const storageUrl = `${fixture.baseUrl}/api/health`;
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-principal-data-"));
  const original = seedLegacy(profileDirectory);
  const scopes = {};
  const alias = await fixture.createAlias();
  try {
    const first = await launchCase({
      baseUrl: fixture.baseUrl,
      events: fixture.events,
      username: "modern-routes",
      profileDirectory,
      exercise: async ({ window, electronApp }) => {
        const rendererErrors = [];
        window.on("pageerror", (error) => rendererErrors.push(String(error)));
        await electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setBounds({ width: 900, height: 760 }),
        );
        assertUnassigned(await readData(window));
        await verifyLegacyPreview(window);
        scopes.A = await readWorkspaceScope(window);
        await cookieSentinels(electronApp, scopes.A, "A", storageUrl, true);
        await importLegacyThroughUi(window, profileDirectory, original);
        await writeData(window, "A");
        await receiveChat(fixture, window, "modern-routes", "A");
        await logout(window);
        await loginThroughForm(window, fixture.baseUrl, "legacy-admin");
        scopes.B = await readWorkspaceScope(window);
        assert.notEqual(scopes.B.principal.principalId, scopes.A.principal.principalId);
        const beforeB = await readData(window);
        assertUnassigned(beforeB);
        assert.equal(beforeB.tasks.memos.length, 0);
        assert.equal(beforeB.notes.length, 0);
        assert.equal(beforeB.focus.sessions.length, 0);
        await writeData(window, "B");
        await receiveChat(fixture, window, "legacy-admin", "B");
        await cookieSentinels(electronApp, scopes.B, "B", storageUrl, true);
        await window.getByRole("button", { name: "个人工作区", exact: true }).click();
        await window.getByText("当前：个人工作区", { exact: true }).waitFor();
        scopes.local = await readWorkspaceScope(window);
        assert.equal(scopes.local.principal.principalId, "local-device");
        await window.getByTestId("legacy-data-open").click();
        await window.getByRole("dialog").waitFor({ state: "visible" });
        assert.equal(
          await window.getByTestId("legacy-data-chat").count(),
          0,
          "personal workspace must not offer unusable team chat imports",
        );
        await window.keyboard.press("Escape");
        await window.getByRole("dialog").waitFor({ state: "hidden" });
        assertUnassigned(await readData(window));
        await writeData(window, "local");
        await cookieSentinels(electronApp, scopes.local, "local", storageUrl, true);
        await loginThroughForm(window, fixture.baseUrl, "modern-routes");
        assertMarker(await readData(window), "A");
        await logout(window);
        await loginThroughForm(window, alias, "modern-routes");
        const aliasScope = await readWorkspaceScope(window);
        assert.equal(aliasScope.principal.principalId, scopes.A.principal.principalId);
        assert.equal(aliasScope.gptPartition, scopes.A.gptPartition);
        assertMarker(await readData(window), "A");
        for (const [label, scope] of Object.entries(scopes))
          assert.deepEqual(await cookieSentinels(electronApp, scope, label, storageUrl), {
            gpt: { cookie: label, localStorage: label },
            claude: { cookie: label, localStorage: label },
            gemini: { cookie: label, localStorage: label },
          });
        verifyOriginal(profileDirectory, original);
        assert.deepEqual(
          rendererErrors,
          [],
          "data import and switching must not throw in the renderer",
        );
        return {
          explicitImports: ["calendar", "tasks", "focus", "chat", "notes"],
          accountIsolation: true,
          personalIsolation: true,
          verifiedAliasContinuity: true,
          legacyBytesUnchanged: true,
          browserCookiesUnchanged: true,
          browserLocalStorageUnchanged: true,
        };
      },
    });
    const restart = await launchCase({
      baseUrl: alias,
      events: fixture.events,
      username: "modern-routes",
      profileDirectory,
      exercise: async ({ window, electronApp }) => {
        const rendererErrors = [];
        window.on("pageerror", (error) => rendererErrors.push(String(error)));
        assertMarker(await readData(window), "A");
        await logout(window);
        await loginThroughForm(window, fixture.baseUrl, "legacy-admin");
        assertMarker(await readData(window), "B");
        await window.getByRole("button", { name: "个人工作区", exact: true }).click();
        await window.getByText("当前：个人工作区", { exact: true }).waitFor();
        assertMarker(await readData(window), "local");
        await loginThroughForm(window, alias, "modern-routes");
        assertMarker(await readData(window), "A");
        for (const [label, scope] of Object.entries(scopes))
          assert.deepEqual(await cookieSentinels(electronApp, scope, label, storageUrl), {
            gpt: { cookie: label, localStorage: label },
            claude: { cookie: label, localStorage: label },
            gemini: { cookie: label, localStorage: label },
          });
        verifyOriginal(profileDirectory, original);
        assert.deepEqual(
          rendererErrors,
          [],
          "restored account scopes must not throw in the renderer",
        );
        return {
          allThreeDataScopesPersisted: true,
          browserCookiesPersisted: true,
          browserLocalStoragePersisted: true,
        };
      },
    });
    assert.deepEqual(first.blockedRequests, []);
    assert.deepEqual(restart.blockedRequests, []);
    process.stdout.write(
      `${JSON.stringify({ ok: true, first: first.exerciseResult, restart: restart.exerciseResult }, null, 2)}\n`,
    );
  } finally {
    await fixture.close();
    fs.rmSync(profileDirectory, { recursive: true, force: true });
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
