const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Worker } = require("node:worker_threads");

function writeJsonAtomic(file, value) {
  const data = JSON.stringify(value, null, 2);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, data, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, file);
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      process.emitWarning("JSON 临时文件清理失败，请检查存储目录权限");
    }
  }
}

function readJsonStore(file, field, onRecovery = console.warn) {
  function read(candidate) {
    const value = JSON.parse(fs.readFileSync(candidate, "utf8"));
    if (!value || !Array.isArray(value[field])) throw new Error("Invalid store schema");
    return value;
  }
  try {
    return read(file);
  } catch (error) {
    if (error.code && error.code !== "ENOENT") throw error;
    const backup = `${file}.backup`;
    if (error.code === "ENOENT" && !fs.existsSync(backup)) return { [field]: [] };
    let recovered;
    try {
      recovered = read(backup);
    } catch {
      throw new Error(`数据文件 ${path.basename(file)} 损坏且无有效备份，已停止读写；原件保留`);
    }
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, `${file}.corrupt-${randomUUID()}`, fs.constants.COPYFILE_EXCL);
    }
    writeJsonAtomic(file, recovered);
    onRecovery(
      `数据文件 ${path.basename(file)} 已从上一份有效备份恢复；损坏原件已保留，请检查可能缺失的最近记录`,
    );
    return recovered;
  }
}

function saveJsonStore(file, value, field) {
  if (!value || !Array.isArray(value[field])) throw new Error("Invalid store schema");
  const previous = readJsonStore(file, field);
  const backup = `${file}.backup`;
  if (!fs.existsSync(file)) {
    writeJsonAtomic(backup, previous);
    writeJsonAtomic(file, value);
    return;
  }

  const temporary = `${file}.${randomUUID()}.tmp`;
  writeJsonAtomic(temporary, value);
  try {
    fs.rmSync(backup, { force: true });
    fs.renameSync(file, backup);
    fs.chmodSync(backup, 0o600);
    fs.renameSync(temporary, file);
  } catch (error) {
    if (!fs.existsSync(file) && fs.existsSync(backup)) {
      fs.copyFileSync(backup, file, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(file, 0o600);
    }
    throw error;
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

let storeWorker;
let nextRequestId = 1;
const pendingRequests = new Map();

function rejectPending(error) {
  for (const { reject } of pendingRequests.values()) reject(error);
  pendingRequests.clear();
}

function getStoreWorker() {
  if (storeWorker) return storeWorker;
  const worker = new Worker(path.join(__dirname, "json_store_worker.js"));
  storeWorker = worker;
  worker.on("message", ({ id, error }) => {
    const pending = pendingRequests.get(id);
    if (!pending) return;
    pendingRequests.delete(id);
    if (pendingRequests.size === 0) worker.unref();
    if (error) {
      const failure = new Error(error.message);
      if (error.code) failure.code = error.code;
      pending.reject(failure);
      return;
    }
    pending.resolve();
  });
  worker.on("error", (error) => {
    rejectPending(error);
    if (storeWorker === worker) storeWorker = undefined;
  });
  worker.on("exit", (code) => {
    if (storeWorker === worker) {
      rejectPending(new Error(`JSON store worker stopped unexpectedly (${code})`));
      storeWorker = undefined;
    }
  });
  worker.unref();
  return worker;
}

function saveJsonStoreAsync(file, value, field) {
  if (!value || !Array.isArray(value[field])) {
    return Promise.reject(new Error("Invalid store schema"));
  }
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    try {
      const worker = getStoreWorker();
      worker.ref();
      worker.postMessage({ id, file, value, field });
    } catch (error) {
      pendingRequests.delete(id);
      if (pendingRequests.size === 0) storeWorker?.unref();
      reject(error);
    }
  });
}

module.exports = { writeJsonAtomic, readJsonStore, saveJsonStore, saveJsonStoreAsync };
