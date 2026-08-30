const RECOVERY_EVENTS = ["resume", "unlock-screen", "user-did-become-active"];

function registerAiRecoverySignals(powerMonitor, handlers = {}) {
  const onSuspend = typeof handlers.onSuspend === "function" ? handlers.onSuspend : () => {};
  const onRecover = typeof handlers.onRecover === "function" ? handlers.onRecover : () => {};
  const listeners = [];

  const suspendListener = () => onSuspend("suspend");
  powerMonitor.on("suspend", suspendListener);
  listeners.push(["suspend", suspendListener]);

  for (const eventName of RECOVERY_EVENTS) {
    const listener = () => onRecover(eventName);
    powerMonitor.on(eventName, listener);
    listeners.push([eventName, listener]);
  }

  return () => {
    for (const [eventName, listener] of listeners) {
      powerMonitor.removeListener(eventName, listener);
    }
  };
}

module.exports = { RECOVERY_EVENTS, registerAiRecoverySignals };
