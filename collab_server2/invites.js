const crypto = require("node:crypto");
const { readJsonStore, saveJsonStore } = require("./json_store");

function validateInvite(invite) {
  const text = (value) => typeof value === "string" && Boolean(value.trim());
  const date = (value) => text(value) && Number.isFinite(Date.parse(value));
  if (
    !text(invite.id) ||
    !text(invite.code) ||
    !/^[\w-]+$/.test(invite.code) ||
    typeof invite.note !== "string" ||
    !text(invite.createdBy) ||
    !date(invite.createdAt) ||
    (invite.expiresAt !== "" && !date(invite.expiresAt)) ||
    (invite.revokedAt !== "" && !date(invite.revokedAt)) ||
    !Number.isSafeInteger(invite.usedCount) ||
    invite.usedCount < 0 ||
    (invite.maxUses !== null && (!Number.isSafeInteger(invite.maxUses) || invite.maxUses < 1)) ||
    typeof invite.chatDisabled !== "boolean" ||
    !Array.isArray(invite.allowedProxyRouteIds) ||
    invite.allowedProxyRouteIds.some((id) => !text(id)) ||
    !Array.isArray(invite.registrations) ||
    invite.registrations.length !== invite.usedCount ||
    invite.registrations.some(
      (entry) => !entry || !text(entry.username) || !date(entry.registeredAt),
    )
  ) {
    throw new Error("Invalid invitation record");
  }
}

function inviteSummary(invite, now = Date.now()) {
  const status = invite.revokedAt
    ? "revoked"
    : invite.expiresAt && Date.parse(invite.expiresAt) <= now
      ? "expired"
      : invite.maxUses !== null && invite.usedCount >= invite.maxUses
        ? "exhausted"
        : "active";
  return {
    ...invite,
    status,
    remainingUses: invite.maxUses === null ? null : Math.max(0, invite.maxUses - invite.usedCount),
  };
}

function createInviteHandler({
  file,
  readBody,
  safeParseJson,
  sendJson,
  requireAdminSession,
  resolveClientIp,
  loadUserStore,
  saveUserStore,
  createUserRecord,
  normalizeProxyRouteIds,
  now = Date.now,
  saveInvites = (store) => saveJsonStore(file, store, "invites"),
  rateMax = Number(process.env.INVITE_RATE_MAX) || 60,
  rateWindowMs = Number(process.env.INVITE_RATE_WINDOW_MS) || 60000,
}) {
  const rates = new Map();
  let mutations = Promise.resolve();
  // All mutations run synchronously inside this queue, with fresh stores and no
  // yield between the user write, invite write and any compensating user write.
  const mutate = (operation) => {
    const result = mutations.then(operation);
    mutations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const load = () => readJsonStore(file, "invites");
  const fail = (res, status, message, reason) => {
    sendJson(res, status, { ok: false, ...(reason ? { valid: false, reason } : {}), message });
  };
  function usable(res, invite) {
    if (!invite) {
      fail(res, 404, "邀请链接无效或不存在", "invalid");
      return false;
    }
    validateInvite(invite);
    const { status } = inviteSummary(invite, now());
    if (status === "active") return true;
    const messages = {
      revoked: "邀请链接已撤销",
      expired: "邀请链接已过期",
      exhausted: "邀请链接使用次数已用完",
    };
    fail(res, 410, messages[status], status);
    return false;
  }
  function allowPublic(req, res) {
    const current = now();
    for (const [key, value] of rates) if (value.resetAt <= current) rates.delete(key);
    const ip = resolveClientIp(req);
    let entry = rates.get(ip);
    if (!entry && rates.size < 10000) {
      entry = { count: 0, resetAt: current + rateWindowMs };
      rates.set(ip, entry);
    }
    if (!entry || entry.count >= rateMax) {
      res.setHeader(
        "Retry-After",
        String(Math.ceil((entry ? entry.resetAt - current : rateWindowMs) / 1000)),
      );
      fail(res, 429, "请求过于频繁，请稍后再试");
      return false;
    }
    entry.count += 1;
    return true;
  }
  return async function handleInviteRequest(req, res, url) {
    const pathname = url.pathname;
    const adminList = pathname === "/api/admin/invites";
    const revoke = pathname.match(/^\/api\/admin\/invites\/([^/]+)(\/revoke)?$/);
    const preview = req.method === "GET" && pathname === "/api/invite/preview";
    const register = req.method === "POST" && pathname === "/api/invite/register";
    const adminRead = adminList && req.method === "GET";
    const adminCreate = adminList && req.method === "POST";
    const adminRevoke =
      revoke && ((req.method === "POST" && revoke[2]) || (req.method === "DELETE" && !revoke[2]));
    if (!adminRead && !adminCreate && !adminRevoke && !preview && !register) return false;
    try {
      if (adminRead || adminCreate || adminRevoke) {
        if (!requireAdminSession(req, res)) return true;
        if (adminRead) {
          sendJson(res, 200, {
            invites: load()
              .invites.map((item) => inviteSummary(item, now()))
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          });
          return true;
        }
        const body = await readBody(req);
        await mutate(() => {
          const admin = requireAdminSession(req, res);
          if (!admin) return;
          const store = load();
          if (adminRevoke) {
            const invite = store.invites.find((item) => item.id === decodeURIComponent(revoke[1]));
            if (!invite) {
              fail(res, 404, "邀请不存在");
              return;
            }
            if (!invite.revokedAt) {
              invite.revokedAt = new Date(now()).toISOString();
              saveInvites(store);
            }
            sendJson(res, 200, { ok: true, invite: inviteSummary(invite, now()) });
            return;
          }
          const payload = safeParseJson(body);
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            fail(res, 400, "请求格式无效");
            return;
          }
          const maxUses = payload.maxUses === undefined ? 10 : payload.maxUses;
          const hours = payload.expiresInHours === undefined ? null : payload.expiresInHours;
          if (
            maxUses !== null &&
            maxUses !== 0 &&
            (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000)
          ) {
            fail(res, 400, "使用次数须为 1 至 1000 的整数，或 0/null 表示不限");
            return;
          }
          if (
            hours !== null &&
            hours !== 0 &&
            (typeof hours !== "number" || !Number.isFinite(hours) || hours < 1 || hours > 8760)
          ) {
            fail(res, 400, "有效期须为 1 至 8760 小时，或 0/null 表示永不过期");
            return;
          }
          if (
            payload.note !== undefined &&
            (typeof payload.note !== "string" || Array.from(payload.note.trim()).length > 80)
          ) {
            fail(res, 400, "备注最多 80 字");
            return;
          }
          if (
            payload.allowedProxyRouteIds !== undefined &&
            (!Array.isArray(payload.allowedProxyRouteIds) ||
              payload.allowedProxyRouteIds.some((id) => typeof id !== "string"))
          ) {
            fail(res, 400, "代理线路须为字符串数组");
            return;
          }
          const createdAt = new Date(now()).toISOString();
          const invite = {
            id: `inv_${crypto.randomUUID()}`,
            code: crypto.randomBytes(18).toString("base64url"),
            note: (payload.note || "").trim(),
            createdBy: admin.username,
            createdAt,
            expiresAt: hours ? new Date(now() + hours * 3600000).toISOString() : "",
            maxUses: maxUses || null,
            usedCount: 0,
            revokedAt: "",
            chatDisabled: Boolean(payload.chatDisabled),
            allowedProxyRouteIds: normalizeProxyRouteIds(payload.allowedProxyRouteIds),
            registrations: [],
          };
          store.invites.push(invite);
          saveInvites(store);
          sendJson(res, 200, { ok: true, invite: inviteSummary(invite, now()) });
        });
        return true;
      }
      if (!allowPublic(req, res)) return true;
      if (preview) {
        const invite = load().invites.find((item) => item.code === url.searchParams.get("code"));
        if (usable(res, invite)) {
          const { note, expiresAt, maxUses, usedCount, remainingUses } = inviteSummary(
            invite,
            now(),
          );
          sendJson(res, 200, {
            ok: true,
            valid: true,
            note,
            expiresAt,
            maxUses,
            usedCount,
            remainingUses,
          });
        }
        return true;
      }
      const body = await readBody(req);
      const payload = safeParseJson(body);
      const username = typeof payload?.username === "string" ? payload.username.trim() : "";
      const password = typeof payload?.password === "string" ? payload.password : "";
      if (
        !/^[^\s:\u0000-\u001f\u007f-\u009f]{2,40}$/u.test(username) ||
        password.length < 6 ||
        password.length > 128 ||
        !password.trim()
      ) {
        fail(
          res,
          400,
          "用户名须为 2 至 40 字且不含空白、控制字符或冒号；密码须为 6 至 128 位且不能全为空白",
        );
        return true;
      }
      const displayName =
        (typeof payload.displayName === "string" ? payload.displayName.trim().slice(0, 40) : "") ||
        username;
      await mutate(() => {
        const store = load();
        const invite = store.invites.find((item) => item.code === payload.code);
        if (!usable(res, invite)) return;
        const users = loadUserStore();
        if (users.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
          fail(res, 409, "该用户名已被占用");
          return;
        }
        const previousUsers = { ...users, users: [...users.users] };
        const user = createUserRecord(username, password, {
          displayName,
          isAdmin: false,
          advancedAiAllowed: false,
          disabled: false,
          chatDisabled: Boolean(invite.chatDisabled),
          allowedProxyRouteIds: invite.allowedProxyRouteIds,
          legacyProxyEntitled: !invite.allowedProxyRouteIds.length,
        });
        try {
          users.users.push(user);
          saveUserStore(users);
          invite.usedCount += 1;
          invite.registrations.push({ username, registeredAt: new Date(now()).toISOString() });
          saveInvites(store);
        } catch (error) {
          saveUserStore(previousUsers);
          // The repository rotates its previous file into .backup. Replace that
          // failed candidate too, so recovery cannot resurrect an unregistered user.
          saveUserStore(previousUsers);
          throw error;
        }
        sendJson(res, 200, { ok: true, username, displayName });
      });
    } catch {
      // Public endpoints must not disclose storage paths, admin identities or internals.
      fail(res, 500, "邀请服务暂不可用，请联系管理员");
    }
    return true;
  };
}

module.exports = { createInviteHandler, inviteSummary };
