const { parentPort } = require("node:worker_threads");
const { saveJsonStore } = require("./json_store");

parentPort.on("message", ({ id, file, value, field }) => {
  try {
    saveJsonStore(file, value, field);
    parentPort.postMessage({ id });
  } catch (error) {
    parentPort.postMessage({
      id,
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: error?.code,
      },
    });
  }
});
