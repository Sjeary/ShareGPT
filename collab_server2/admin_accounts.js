const crypto = require("node:crypto");

// Account routes share the existing session map and account repository supplied
// by the server. This module owns no duplicate authentication or persistence state.
function createAdminAccountHandler({
  cleanupExpiredSessions,
  readBody,
  safeParseJson,
  safeText,
  normalizeIp,
  loginLockState,
  recordLoginFail,
  clearLoginFails,
  findUser,
  verifyPassword,
  makeToken,
  adminSessions,
  SESSION_TTL_MS,
  sendText,
  sendJson,
  adminUserSummary,
  hasAdminUser,
  loadUserStore,
  createUserRecord,
  saveUserStore,
  extractBearer,
  requireAdminSession,
  MAX_AVATAR_LENGTH,
  inferAvatarKind,
  normalizeProxyRouteIds,
  hashPassword,
  nowIso,
  revokeUserSessions,
  normalizeUserRecord,
}) {
  return async function handleAdminAccountRequest(req, res, pathname) {
    if (req.method === "POST" && pathname === "/api/admin/login") {
      try {
        cleanupExpiredSessions();
        const body = await readBody(req);
        const payload = safeParseJson(body);
        const username = safeText(payload?.username);
        const password = String(payload?.password || "");
        const attemptKey = `admin:${normalizeIp(req.socket?.remoteAddress)}`;
        const lock = loginLockState(attemptKey);
        if (lock.locked) {
          res.setHeader("Retry-After", String(Math.ceil(lock.retryAfterMs / 1000)));
          sendText(
            res,
            429,
            `登录失败次数过多，请 ${Math.ceil(lock.retryAfterMs / 1000)} 秒后再试`,
          );
          return true;
        }
        const { user } = findUser(username);

        if (!user || !user.isAdmin || user.disabled || !verifyPassword(user, password)) {
          recordLoginFail(attemptKey);
          sendText(res, 401, "管理员账号或密码错误");
          return true;
        }
        clearLoginFails(attemptKey);

        const token = makeToken();
        const now = Date.now();
        adminSessions.set(token, {
          token,
          username,
          displayName: safeText(user.displayName) || username,
          issuedAt: now,
          expiresAt: now + SESSION_TTL_MS,
        });

        sendJson(res, 200, {
          token,
          profile: adminUserSummary(user),
        });
      } catch (err) {
        sendText(res, 500, err.message || "管理员登录失败");
      }
      return true;
    }

    if (req.method === "POST" && pathname === "/api/admin/setup") {
      try {
        if (hasAdminUser()) {
          sendText(res, 409, "服务器已经存在管理员账号");
          return true;
        }
        const body = await readBody(req);
        const payload = safeParseJson(body) || {};
        const username = safeText(payload.username);
        const password = String(payload.password || "");
        const displayName = safeText(payload.displayName) || username;

        const store = loadUserStore();
        // The body read yields. Recheck the same snapshot that is synchronously
        // committed so two pending setup requests cannot both create an admin.
        if (store.users.some((item) => item.isAdmin)) {
          sendText(res, 409, "服务器已经存在管理员账号");
          return true;
        }
        const existing = store.users.find((item) => item.username === username);
        if (existing) {
          sendText(res, 409, "该用户已存在");
          return true;
        }

        const record = createUserRecord(username, password, {
          displayName,
          isAdmin: true,
        });
        store.users.push(record);
        saveUserStore(store);

        const token = makeToken();
        const now = Date.now();
        adminSessions.set(token, {
          token,
          username,
          displayName: safeText(record.displayName) || username,
          issuedAt: now,
          expiresAt: now + SESSION_TTL_MS,
        });

        sendJson(res, 200, {
          token,
          profile: adminUserSummary(record),
        });
      } catch (err) {
        sendText(res, 400, err.message || "初始化管理员失败");
      }
      return true;
    }

    if (req.method === "POST" && pathname === "/api/admin/logout") {
      const token = extractBearer(req);
      if (token) {
        adminSessions.delete(token);
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/admin/users") {
      const adminSession = requireAdminSession(req, res);
      if (!adminSession) return true;
      const store = loadUserStore();
      sendJson(res, 200, {
        users: store.users
          .map(adminUserSummary)
          .sort((a, b) => a.username.localeCompare(b.username)),
        admin: {
          username: adminSession.username,
          displayName: adminSession.displayName,
        },
      });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/admin/users") {
      const adminSession = requireAdminSession(req, res);
      if (!adminSession) return true;
      try {
        const body = await readBody(req);
        if (!requireAdminSession(req, res)) return true;
        const payload = safeParseJson(body) || {};
        const username = safeText(payload.username);
        const password = String(payload.password || "");
        const store = loadUserStore();
        const existing = store.users.find((item) => item.username === username);
        if (existing) {
          sendText(res, 409, "该用户已存在");
          return true;
        }

        const record = createUserRecord(username, password, payload);
        store.users.push(record);
        saveUserStore(store);
        sendJson(res, 200, {
          ok: true,
          user: adminUserSummary(record),
        });
      } catch (err) {
        sendText(res, 400, err.message || "创建用户失败");
      }
      return true;
    }

    if (
      (req.method === "PATCH" || req.method === "PUT") &&
      pathname.startsWith("/api/admin/users/")
    ) {
      const adminSession = requireAdminSession(req, res);
      if (!adminSession) return true;
      try {
        const username = decodeURIComponent(pathname.slice("/api/admin/users/".length));
        const body = await readBody(req);
        if (!requireAdminSession(req, res)) return true;
        const payload = safeParseJson(body) || {};
        const store = loadUserStore();
        const user = store.users.find((item) => item.username === username);
        if (!user) {
          sendText(res, 404, "用户不存在");
          return true;
        }
        if (
          user.isAdmin &&
          typeof payload.isAdmin !== "undefined" &&
          !Boolean(payload.isAdmin) &&
          !store.users.some(
            (other) => other.username !== user.username && other.isAdmin && !other.disabled,
          )
        ) {
          sendText(res, 409, "请先为其他启用账号授予管理员权限，再移除此账号的管理员权限");
          return true;
        }

        const nextPassword = String(payload.password || "");
        let securityChanged = false;

        if (typeof payload.displayName !== "undefined")
          user.displayName = safeText(payload.displayName).slice(0, 30) || user.username;
        if (typeof payload.bio !== "undefined") user.bio = safeText(payload.bio).slice(0, 200);
        if (typeof payload.avatar !== "undefined") {
          user.avatar = safeText(payload.avatar).slice(0, MAX_AVATAR_LENGTH);
          user.avatarKind = inferAvatarKind(user.avatar);
        }
        if (
          typeof payload.disabled !== "undefined" &&
          Boolean(payload.disabled) !== Boolean(user.disabled)
        ) {
          user.disabled = Boolean(payload.disabled);
          securityChanged = true;
        }
        if (
          typeof payload.isAdmin !== "undefined" &&
          Boolean(payload.isAdmin) !== Boolean(user.isAdmin)
        ) {
          const wasAdmin = Boolean(user.isAdmin);
          user.isAdmin = Boolean(payload.isAdmin);
          if (wasAdmin && !user.isAdmin && typeof payload.advancedAiAllowed === "undefined") {
            user.advancedAiAllowed = false;
            user.legacyProxyEntitled = false;
          }
          securityChanged = true;
        }
        if (typeof payload.advancedAiAllowed !== "undefined")
          if (Boolean(payload.advancedAiAllowed) !== Boolean(user.advancedAiAllowed)) {
            user.advancedAiAllowed = Boolean(payload.advancedAiAllowed);
            user.legacyProxyEntitled = false;
            securityChanged = true;
          }
        if (typeof payload.allowedProxyRouteIds !== "undefined") {
          const requestedRouteIds = normalizeProxyRouteIds(payload.allowedProxyRouteIds);
          const currentRouteIds = normalizeProxyRouteIds(user.allowedProxyRouteIds);
          const sameRoutes =
            requestedRouteIds.length === currentRouteIds.length &&
            requestedRouteIds.every((id) => currentRouteIds.includes(id));
          if (!sameRoutes) {
            user.allowedProxyRouteIds = requestedRouteIds;
            user.legacyProxyEntitled = false;
            securityChanged = true;
          }
        }
        if (
          typeof payload.chatDisabled !== "undefined" &&
          Boolean(payload.chatDisabled) !== Boolean(user.chatDisabled)
        ) {
          user.chatDisabled = Boolean(payload.chatDisabled);
          securityChanged = true;
        }
        if (nextPassword && !verifyPassword(user, nextPassword)) {
          const salt = crypto.randomBytes(16).toString("hex");
          user.salt = salt;
          user.passwordHash = hashPassword(nextPassword, salt, 120000, "sha256");
          user.iterations = 120000;
          user.digest = "sha256";
          securityChanged = true;
        }
        user.updatedAt = nowIso();
        saveUserStore(store);
        if (securityChanged) revokeUserSessions(user.username);
        sendJson(res, 200, {
          ok: true,
          user: adminUserSummary(normalizeUserRecord(user)),
        });
      } catch (err) {
        sendText(res, 400, err.message || "更新用户失败");
      }
      return true;
    }
    return false;
  };
}

module.exports = { createAdminAccountHandler };
