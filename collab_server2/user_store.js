const fs = require("node:fs");
const { readJsonStore, saveJsonStore, writeJsonAtomic } = require("./json_store");

// Shared by the HTTP service and the local account-management command. An
// established deployment must never become a fresh installation after data loss.
function createUserStore(file, { identityFile } = {}) {
  const initializedFile = `${file}.initialized`;
  function unavailable(cause) {
    const error = new Error("账号数据不可用，请恢复服务端数据备份后重试", { cause });
    error.code = "USER_STORE_UNAVAILABLE";
    return error;
  }

  function validate(store) {
    if (!store || !Array.isArray(store.users)) throw unavailable();
    const names = new Set();
    for (const user of store.users) {
      if (
        !user ||
        typeof user.username !== "string" ||
        !user.username.trim() ||
        names.has(user.username) ||
        typeof user.passwordHash !== "string" ||
        !user.passwordHash ||
        typeof user.salt !== "string" ||
        !user.salt
      ) {
        throw unavailable();
      }
      names.add(user.username);
    }
    return store;
  }

  function markInitialized(store) {
    if (store.users.length && !fs.existsSync(initializedFile)) {
      writeJsonAtomic(initializedFile, { version: 1 });
    }
  }

  function load() {
    try {
      const store = validate(readJsonStore(file, "users"));
      if (
        !store.users.length &&
        (fs.existsSync(initializedFile) || (identityFile && fs.existsSync(identityFile)))
      ) {
        throw unavailable();
      }
      markInitialized(store);
      // Upgrade an existing valid legacy store to recoverable storage on first use.
      if (store.users.length && !fs.existsSync(`${file}.backup`)) {
        writeJsonAtomic(`${file}.backup`, store);
      }
      return store;
    } catch (error) {
      if (error.code === "USER_STORE_UNAVAILABLE") throw error;
      throw unavailable(error);
    }
  }

  function save(store) {
    validate(store);
    const previous = load();
    saveJsonStore(file, store, "users");
    markInitialized(store);
    if (!previous.users.length && store.users.length) {
      writeJsonAtomic(`${file}.backup`, store);
    }
  }

  return { load, save };
}

module.exports = { createUserStore };
