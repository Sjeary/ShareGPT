const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, WebContentsView } = require("electron");
const {
  COMPOSER_OPERATION_WORLD_ID,
  composerConfirmationGuardScript,
  composerConfirmationResolveScript,
  composerOperationIsCurrent,
  createComposerOperation,
  createOperationToken,
  executeComposerWrite,
  parseComposerConfirmationMessage,
  sendComposerEnter,
  waitForComposerConfirmationReplay,
  waitForComposerOutcome,
} = require("../src/main/aiComposerOperation");
const {
  createTrackerToken,
  installAcceptedSendTracker,
  parseSendAttemptMessage,
} = require("../src/main/aiUsageAcceptance");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-ai-composer-"));
app.setPath("userData", userData);

function startFixture() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(`<!doctype html><meta charset="utf-8">
      <form id="composer"><textarea id="prompt" style="width:400px;height:100px"></textarea>
      <button data-testid="send-button" type="submit">Send</button></form>
      <form id="search"><input id="search-input" type="text"><button type="submit">Search</button></form>
      <script>
        window.accepted = 0;
        window.searchSubmits = 0;
        const form = document.querySelector('#composer');
        const editor = document.querySelector('#prompt');
        editor.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
          event.preventDefault();
          form.requestSubmit();
        });
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          if (!editor.value.trim()) return;
          window.accepted += 1;
          editor.value = '';
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const search = document.querySelector('#search');
        const searchInput = document.querySelector('#search-input');
        searchInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') { event.preventDefault(); search.requestSubmit(); }
        });
        search.addEventListener('submit', (event) => {
          event.preventDefault();
          window.searchSubmits += 1;
        });
      </script>`);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}/` });
    });
  });
}

async function waitFor(predicate, label, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${label} timed out`);
}

async function setPrompt(webContents, text) {
  await webContents.executeJavaScript(`(() => {
    const editor = document.querySelector('#prompt');
    editor.value = ${JSON.stringify(text)};
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.focus();
  })()`);
}

async function acceptedCount(webContents) {
  return webContents.executeJavaScript("window.accepted");
}

async function main() {
  await app.whenReady();
  const fixture = await startFixture();
  // CDP focus emulation keeps trusted keyboard delivery deterministic on CI,
  // where the native runner window is not guaranteed to become the foreground app.
  if (process.platform === "darwin") app.dock.hide();
  const window = new BrowserWindow({ show: false, width: 640, height: 480 });
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 640, height: 480 });
  const wc = view.webContents;
  const guardToken = createOperationToken();
  const usageToken = createTrackerToken();
  const consoleMessages = [];
  let documentEpoch = 1;
  wc.on("console-message", (event) => {
    consoleMessages.push(String(event?.message || ""));
  });
  wc.on("did-navigate-in-page", () => {
    documentEpoch += 1;
  });

  const runGuard = (enabled) =>
    wc.executeJavaScriptInIsolatedWorld(
      COMPOSER_OPERATION_WORLD_ID,
      [{ code: composerConfirmationGuardScript(guardToken, { enabled, targetLanguage: "en" }) }],
      false,
    );
  const snapshot = () => ({
    principalId: "fixture-principal",
    kind: "gpt",
    environmentId: "",
    tabId: "fixture-tab",
    workspaceInstanceId: "fixture-workspace",
    webContentsId: wc.id,
    documentEpoch,
    url: wc.getURL(),
  });
  const dispatchEnter = async (selector = "#prompt") => {
    await wc.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await waitFor(
      () =>
        wc.executeJavaScript(
          `document.hasFocus() && document.activeElement === document.querySelector(${JSON.stringify(selector)})`,
        ),
      "fixture document focus",
    );
    await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
  };

  try {
    await wc.loadURL(fixture.url);
    wc.debugger.attach("1.3");
    await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    await installAcceptedSendTracker(wc, usageToken);

    process.stdout.write("[verify] guard off leaves non-target Enter untouched\n");
    await runGuard(false);
    await setPrompt(wc, "请总结这段内容");
    await dispatchEnter();
    await waitFor(async () => (await acceptedCount(wc)) === 1, "guard-off send");

    process.stdout.write(
      "[verify] guard on passes target language and blocks non-target language\n",
    );
    await runGuard(true);
    await wc.executeJavaScript("document.querySelector('#search-input').value = '中文搜索'");
    await dispatchEnter("#search-input");
    await waitFor(
      () => wc.executeJavaScript("window.searchSubmits === 1"),
      "unrelated search Enter",
    );
    assert.equal(
      consoleMessages.some((message) => parseComposerConfirmationMessage(message, guardToken)),
      false,
      "unrelated forms must not create a chat confirmation",
    );
    await setPrompt(wc, "Please summarize this page");
    await dispatchEnter();
    await waitFor(async () => (await acceptedCount(wc)) === 2, "target-language send");
    await setPrompt(wc, "请总结这段内容");
    await dispatchEnter();
    const firstConfirmation = await waitFor(
      async () =>
        consoleMessages
          .map((message) => parseComposerConfirmationMessage(message, guardToken))
          .find(Boolean),
      "non-target confirmation",
    );
    assert.equal(await acceptedCount(wc), 2);
    assert.ok(!consoleMessages.some((message) => message.includes("请总结")));

    process.stdout.write("[verify] cancel and close converge without sending\n");
    const cancelled = await wc.executeJavaScriptInIsolatedWorld(
      COMPOSER_OPERATION_WORLD_ID,
      [{ code: composerConfirmationResolveScript(guardToken, firstConfirmation.id, false) }],
      false,
    );
    assert.deepEqual(cancelled, { ok: true, replay: "" });
    assert.equal(await acceptedCount(wc), 2);

    consoleMessages.length = 0;
    await setPrompt(wc, "请关闭这次提示");
    await dispatchEnter();
    const closedRequest = await waitFor(
      async () =>
        consoleMessages
          .map((message) => parseComposerConfirmationMessage(message, guardToken))
          .find(Boolean),
      "close confirmation",
    );
    const closed = await wc.executeJavaScriptInIsolatedWorld(
      COMPOSER_OPERATION_WORLD_ID,
      [{ code: composerConfirmationResolveScript(guardToken, closedRequest.id, false) }],
      false,
    );
    assert.deepEqual(closed, { ok: true, replay: "" });
    assert.equal(await acceptedCount(wc), 2);

    consoleMessages.length = 0;
    await setPrompt(wc, "请再次总结");
    await dispatchEnter();
    const confirmedRequest = await waitFor(
      async () =>
        consoleMessages
          .map((message) => parseComposerConfirmationMessage(message, guardToken))
          .find(Boolean),
      "second confirmation",
    );
    const confirmed = await wc.executeJavaScriptInIsolatedWorld(
      COMPOSER_OPERATION_WORLD_ID,
      [{ code: composerConfirmationResolveScript(guardToken, confirmedRequest.id, true) }],
      false,
    );
    assert.equal(confirmed.replay, "enter");
    sendComposerEnter(wc);
    const replay = await waitForComposerConfirmationReplay(wc, guardToken, confirmed.replayId);
    assert.equal(replay.consumed, true);
    await waitFor(async () => (await acceptedCount(wc)) === 3, "confirmed send");
    await waitFor(
      async () => consoleMessages.some((message) => parseSendAttemptMessage(message, usageToken)),
      "send-attempt marker",
    );
    const attemptMarkers = consoleMessages
      .map((message) => parseSendAttemptMessage(message, usageToken))
      .filter(Boolean);
    assert.equal(attemptMarkers.length, 1);

    process.stdout.write(
      "[verify] explicit programmatic fill and send use the captured document\n",
    );
    await setPrompt(wc, "existing draft");
    const preserve = createComposerOperation(snapshot(), {
      text: "translated",
      send: false,
      strategy: "fail-if-not-empty",
    });
    assert.deepEqual(await executeComposerWrite(wc, preserve), {
      ok: false,
      sent: false,
      conflict: "existing-draft",
    });
    assert.equal(
      await wc.executeJavaScript("document.querySelector('#prompt').value"),
      "existing draft",
    );
    const append = createComposerOperation(snapshot(), {
      text: "translated",
      send: false,
      strategy: "append",
    });
    await executeComposerWrite(wc, append);
    assert.equal(
      await wc.executeJavaScript("document.querySelector('#prompt').value"),
      "existing draft\n\ntranslated",
    );
    const fill = createComposerOperation(snapshot(), { text: "filled text", send: false });
    await executeComposerWrite(wc, fill);
    assert.equal(
      await wc.executeJavaScript("document.querySelector('#prompt').value"),
      "filled text",
    );
    const send = createComposerOperation(snapshot(), { text: "programmatic send", send: true });
    const armed = await executeComposerWrite(wc, send);
    assert.equal(armed.armed, true);
    await dispatchEnter();
    assert.equal((await waitForComposerOutcome(wc, send.token)).status, "accepted");
    await waitFor(async () => (await acceptedCount(wc)) === 4, "programmatic send");

    process.stdout.write("[verify] SPA navigation invalidates the old captured target\n");
    const beforeSpa = createComposerOperation(snapshot(), { text: "stale", send: false });
    await wc.executeJavaScript("history.pushState({}, '', '/next-route')");
    await waitFor(
      () => Promise.resolve(documentEpoch > beforeSpa.target.documentEpoch),
      "SPA epoch",
    );
    assert.equal(composerOperationIsCurrent(beforeSpa, snapshot()), false);

    process.stdout.write(
      "[verify] disabling guard on the loaded document takes effect immediately\n",
    );
    await runGuard(false);
    await setPrompt(wc, "关闭后直接发送");
    await dispatchEnter();
    await waitFor(async () => (await acceptedCount(wc)) === 5, "guard disable refresh");

    process.stdout.write("[verify] editor mutations during write fail closed in real Chromium\n");
    for (const richText of [false, true]) {
      await wc.executeJavaScript(`(() => {
        const editor = document.createElement(${JSON.stringify(richText ? "div" : "textarea")});
        editor.id = 'prompt';
        editor.style.cssText = 'width:400px;height:100px;white-space:pre-wrap';
        if (${richText}) editor.contentEditable = 'true';
        document.querySelector('#prompt').replaceWith(editor);
      })()`);
      for (const strategy of ["fail-if-not-empty", "append", "replace"]) {
        process.stdout.write(
          `[verify] ${richText ? "contenteditable" : "textarea"} multiline ${strategy}\n`,
        );
        const text = "first line\nsecond line";
        await executeComposerWrite(wc, createComposerOperation(snapshot(), { text, strategy }));
        assert.equal(
          await wc.executeJavaScript(
            "(() => { const node = document.querySelector('#prompt'); if ('value' in node) return node.value.trim(); const range = document.createRange(); range.selectNodeContents(node); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); const text = selection.toString().trim(); selection.collapseToEnd(); return text; })()",
          ),
          strategy === "append" ? `${text}\n\n${text}` : text,
        );
      }
      for (const phase of ["focus", "beforeinput", "input", "change"]) {
        for (const mutation of ["replace", "focus", "text"]) {
          await wc.executeJavaScript(`(() => {
            const old = document.querySelector('#prompt');
            const editor = document.createElement(${JSON.stringify(richText ? "div" : "textarea")});
            editor.id = 'prompt';
            editor.style.cssText = 'width:400px;height:100px;white-space:pre-wrap';
            if (${richText}) editor.contentEditable = 'true';
            const write = (node, text) => { if ('value' in node) node.value = text; else node.textContent = text; };
            write(editor, 'original draft');
            old.replaceWith(editor);
            window.replacedEditor = null;
            editor.addEventListener(${JSON.stringify(phase)}, () => {
              const mutation = ${JSON.stringify(mutation)};
              if (mutation === 'replace') {
                const replacement = editor.cloneNode(true);
                write(replacement, 'replacement draft');
                editor.replaceWith(replacement);
                replacement.focus();
                window.replacedEditor = replacement;
              } else if (mutation === 'focus') document.querySelector('#search-input').focus();
              else write(editor, 'new user draft');
            }, { once: true });
          })()`);
          const operation = createComposerOperation(snapshot(), { text: "translated", send: true });
          await assert.rejects(
            executeComposerWrite(wc, operation),
            { code: "COMPOSER_WRITE_REJECTED" },
            `${richText ? "contenteditable" : "textarea"} ${phase} ${mutation}`,
          );
          if (mutation === "replace") {
            assert.equal(
              await wc.executeJavaScript(
                "window.replacedEditor.value ?? window.replacedEditor.textContent",
              ),
              "replacement draft",
            );
          }
          assert.equal(await acceptedCount(wc), 5);
        }
      }
    }

    // Reload the fixture so the original editor and page submit handlers are restored.
    await wc.loadURL(fixture.url);
    await installAcceptedSendTracker(wc, usageToken);
    consoleMessages.length = 0;
    process.stdout.write(
      "[verify] expired queued Enter cannot submit; the next normal Enter still works\n",
    );
    const expiredSend = createComposerOperation(snapshot(), { text: "expired send", send: true });
    await executeComposerWrite(wc, expiredSend, { ttlMs: 100 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await dispatchEnter();
    assert.equal((await waitForComposerOutcome(wc, expiredSend.token)).reason, "timeout");
    assert.equal(await acceptedCount(wc), 0);
    assert.equal(
      consoleMessages.filter((message) => parseSendAttemptMessage(message, usageToken)).length,
      0,
    );
    await dispatchEnter();
    await waitFor(
      async () => (await acceptedCount(wc)) === 1,
      "normal Enter after consumed stale operation",
    );
    process.stdout.write("[verify] AI composer behavior passed\n");
  } finally {
    try {
      wc.close({ waitForBeforeUnload: false });
    } catch {}
    window.destroy();
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

main()
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  });
