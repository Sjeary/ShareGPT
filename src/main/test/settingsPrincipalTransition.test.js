const test = require("node:test");
const assert = require("node:assert/strict");
const { runSettingsPrincipalTransition } = require("../settingsPrincipalTransition");

test("a failed settings principal transition restores the active Notes AI lifecycle", () => {
  const calls = [];
  const notesAi = {
    invalidatePrincipal() {
      calls.push("invalidate");
    },
    activatePrincipal() {
      calls.push("activate");
    },
  };

  assert.throws(
    () =>
      runSettingsPrincipalTransition(notesAi, () => {
        calls.push("transition");
        throw new Error("transition failed");
      }),
    /transition failed/,
  );
  assert.deepEqual(calls, ["invalidate", "transition", "activate"]);
});
