const USER_STORE_KINDS = new Set(["calendar", "tasks", "notes", "browser-privacy"]);

// Transport adapter for the existing per-account store and revision authority.
function createUserDataHandler({
  extractBearer,
  resolveSessionByToken,
  sendText,
  sendJson,
  getUserStoreEntry,
  loadUserStores,
  safeParseJson,
  readBody,
  putUserStore,
  saveUserStores,
  broadcastToUser,
}) {
  return async function handleUserDataRequest(req, res, pathname) {
    if (pathname.startsWith("/api/user-store/")) {
      const token = extractBearer(req);
      const session = resolveSessionByToken(token);
      if (!session) {
        sendText(res, 401, "未授权");
        return true;
      }
      const kind = decodeURIComponent(pathname.slice("/api/user-store/".length));
      if (!USER_STORE_KINDS.has(kind)) {
        sendText(res, 404, "Not Found");
        return true;
      }

      if (req.method === "GET") {
        const entry = getUserStoreEntry(loadUserStores(), session.username, kind);
        sendJson(res, 200, {
          rev: entry.rev,
          updatedAt: entry.updatedAt,
          data: entry.data,
        });
        return true;
      }

      if (req.method === "PUT") {
        try {
          const payload = safeParseJson(await readBody(req, 8 * 1024 * 1024)) || {};
          const baseRev = Number.isInteger(payload.baseRev) ? payload.baseRev : 0;
          const data = payload.data;
          if (!data || typeof data !== "object") {
            sendText(res, 400, "data 必填");
            return true;
          }
          const stores = loadUserStores();
          const result = putUserStore(stores, session.username, kind, baseRev, data);
          if (!result.ok) {
            sendJson(res, 409, result);
            return true;
          }
          saveUserStores(stores);
          broadcastToUser(
            session.username,
            {
              type: "user_store_updated",
              kind,
              rev: result.rev,
              updatedAt: result.updatedAt,
              data: result.data,
            },
            token,
          );
          sendJson(res, 200, {
            ok: true,
            rev: result.rev,
            updatedAt: result.updatedAt,
            data: result.data,
          });
        } catch (err) {
          sendText(res, 500, err.message || "保存失败");
        }
        return true;
      }
    }
    return false;
  };
}

module.exports = { createUserDataHandler };
