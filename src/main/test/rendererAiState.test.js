const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const { create } = require("../../renderer-next/node_modules/zustand");

// Exercise the actual renderer stores without Electron or provider/network access.
function loadRendererModule(relativePath, dependencies = {}) {
  const filename = path.join(__dirname, "../../renderer-next/src", relativePath);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: /** @type {any} */ ({}) };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    window: { innerWidth: 1000 },
    require: (name) => {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}

function translationStore() {
  return loadRendererModule("store/useTranslationStore.ts", {
    zustand: { create },
    "@/lib/api": { api: {} },
    "@/lib/settingsPrincipalRuntime": { settingsPrincipalRuntime: {} },
    "@/lib/translationWorkflow": loadRendererModule("lib/translationWorkflow.ts"),
    "@/store/useAppStore": { useAppStore: {} },
  }).useTranslationStore;
}

test("changing output format preserves stale and failed translation validity", () => {
  const store = translationStore();
  const actions = store.getState();
  actions.setComposerSourceText("original A");
  actions.beginComposerTranslation();
  actions.completeComposerTranslation("translation A");
  actions.setComposerSourceText("new original B");
  actions.setComposerOutputFormat("bilingual");
  assert.equal(store.getState().composer.phase, "stale");
  assert.match(store.getState().composer.status, /重新生成/);
  actions.setComposerOutputFormat("translated");
  assert.equal(store.getState().composer.phase, "stale");

  actions.beginComposerTranslation();
  actions.appendComposerTranslation("partial");
  store.setState((state) => ({
    composer: { ...state.composer, phase: "error", loading: false, status: "连接中断" },
  }));
  actions.setComposerOutputFormat("bilingual");
  assert.equal(store.getState().composer.phase, "error");
  assert.equal(store.getState().composer.status, "连接中断");

  actions.completeComposerTranslation("translation B");
  actions.setComposerOutputFormat("translated");
  assert.equal(store.getState().composer.phase, "ready");
  assert.equal(store.getState().composer.preview, "translation B");
});

test("inline AI writes only to the captured unchanged document and operation", () => {
  const store = loadRendererModule("store/useEditorBridge.ts", {
    zustand: { create },
  }).useEditorBridge;
  const changes = [];
  const makeView = (text) => ({
    state: {
      doc: { length: text.length },
      selection: { main: { from: 0, to: text.length } },
      sliceDoc: () => text,
    },
    coordsAtPos: () => null,
    dispatch: (transaction) => changes.push(transaction),
    focus: () => {},
  });
  const a = makeView("note A");
  const b = makeView("note B");
  store.getState().setView(a);
  store.getState().openAiEdit();
  const original = store.getState().aiEdit;
  store.getState().closeAiEdit();
  store.getState().openAiEdit();
  assert.equal(store.getState().replaceRange(original, "late A"), false);
  const reopened = store.getState().aiEdit;
  store.getState().setView(b);
  assert.equal(store.getState().aiEdit, null);
  store.getState().openAiEdit();
  assert.equal(store.getState().replaceRange(reopened, "late A"), false);
  const capturedB = store.getState().aiEdit;
  b.state.doc = { length: 7 };
  assert.equal(store.getState().replaceRange(capturedB, "stale B"), false);
  store.getState().setSelection({ from: 0, to: 0, text: "" });
  assert.equal(store.getState().aiEdit, null);
  store.getState().openAiEdit();
  assert.equal(store.getState().replaceRange(store.getState().aiEdit, "new B"), true);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].changes.insert, "new B");
});
