function safeIdentity(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function requestKey(username, requestId) {
  return `${safeIdentity(username, 80)}\0${safeIdentity(requestId, 100)}`;
}

function createTranslationRequestRegistry() {
  const active = new Map();

  return {
    begin(username, requestId) {
      const key = requestKey(username, requestId);
      if (active.has(key)) throw new Error("相同的翻译请求仍在处理中");
      const controller = new AbortController();
      active.set(key, controller);
      return { key, controller };
    },
    cancel(username, requestId) {
      const controller = active.get(requestKey(username, requestId));
      if (!controller) return false;
      controller.abort();
      return true;
    },
    finish(key, controller) {
      if (active.get(key) === controller) active.delete(key);
    },
    size() {
      return active.size;
    },
  };
}

module.exports = { createTranslationRequestRegistry, requestKey };
