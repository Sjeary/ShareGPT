const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { RECOVERY_EVENTS, registerAiRecoverySignals } = require("../aiRecoverySignals");

test("system wake signals converge on one recovery callback", () => {
  const monitor = new EventEmitter();
  const calls = [];
  const dispose = registerAiRecoverySignals(monitor, {
    onSuspend: (reason) => calls.push(`suspend:${reason}`),
    onRecover: (reason) => calls.push(`recover:${reason}`),
  });

  monitor.emit("suspend");
  for (const eventName of RECOVERY_EVENTS) monitor.emit(eventName);

  assert.deepEqual(calls, [
    "suspend:suspend",
    "recover:resume",
    "recover:unlock-screen",
    "recover:user-did-become-active",
  ]);

  dispose();
  monitor.emit("resume");
  assert.equal(calls.length, 4);
});
