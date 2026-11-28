const crypto = require("node:crypto");
const { readJsonStore, saveJsonStore } = require("./json_store");

// This domain owns shared-calendar normalization, persistence and HTTP behavior.
function createTeamCalendarHandler({
  file,
  nowIso,
  safeText,
  sessionForRequest,
  requireCurrentSession,
  readBody,
  safeParseJson,
  sendText,
  sendJson,
  broadcastToSubnet,
}) {
  const CALENDAR_RSVP_VALUES = ["needs_action", "accept", "decline", "tentative"];

  function normalizeRsvp(value) {
    const v = safeText(value);
    return CALENDAR_RSVP_VALUES.includes(v) ? v : "needs_action";
  }

  function normalizeAttendee(record) {
    const username = safeText(record?.username);
    if (!username) return null;
    return {
      username,
      displayName: safeText(record?.displayName) || username,
      rsvp: normalizeRsvp(record?.rsvp),
    };
  }

  function validEventInput(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) return false;
    if (typeof record.title !== "string" || !record.title.trim()) return false;
    const validDate = (value) => {
      if (typeof value !== "string") return false;
      const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
      if (!match || !Number.isFinite(Date.parse(value))) return false;
      const date = new Date(`${match[0].slice(0, 10)}T00:00:00Z`);
      return date.toISOString().slice(0, 10) === match[0].slice(0, 10);
    };
    if (!validDate(record.start)) return false;
    if (record.end !== undefined && !validDate(record.end)) return false;
    return Date.parse(record.end ?? record.start) >= Date.parse(record.start);
  }

  function editAttendees(records, previous = []) {
    const responses = new Map(previous.map((a) => [a.username, a.rsvp]));
    return records.map((record) => ({
      ...record,
      rsvp: responses.get(safeText(record?.username)) || "needs_action",
    }));
  }

  function normalizeTeamEvent(record) {
    const id = safeText(record?.id);
    const title = safeText(record?.title).slice(0, 200);
    const start = safeText(record?.start);
    const end = safeText(record?.end);
    if (!id || !start) return null;
    const attendees = Array.isArray(record?.attendees)
      ? record.attendees.map(normalizeAttendee).filter(Boolean)
      : [];
    const dedupAttendees = [];
    const seen = new Set();
    for (const a of attendees) {
      if (seen.has(a.username)) {
        const idx = dedupAttendees.findIndex((x) => x.username === a.username);
        if (idx >= 0) dedupAttendees[idx] = a;
        continue;
      }
      seen.add(a.username);
      dedupAttendees.push(a);
    }
    return {
      id,
      subnetKey: safeText(record?.subnetKey),
      title,
      description: safeText(record?.description).slice(0, 2000),
      location: safeText(record?.location).slice(0, 200),
      start,
      end: end || start,
      allDay: Boolean(record?.allDay),
      organizer: safeText(record?.organizer),
      attendees: dedupAttendees,
      color: safeText(record?.color).slice(0, 32),
      createdBy: safeText(record?.createdBy),
      createdAt: safeText(record?.createdAt) || nowIso(),
      updatedAt: safeText(record?.updatedAt) || nowIso(),
    };
  }

  function loadCalendarStore() {
    const raw = readJsonStore(file, "events");
    return { events: raw.events.map(normalizeTeamEvent).filter(Boolean) };
  }

  function saveCalendarStore(store) {
    const events = Array.isArray(store?.events)
      ? store.events.map(normalizeTeamEvent).filter(Boolean)
      : [];
    saveJsonStore(file, { events }, "events");
  }

  function eventsForSubnet(subnetKey) {
    return loadCalendarStore().events.filter((e) => e.subnetKey === subnetKey);
  }

  return async function handleTeamCalendarRequest(req, res, pathname) {
    if (
      pathname !== "/api/team-calendar/events" &&
      !pathname.startsWith("/api/team-calendar/events/")
    )
      return false;
    try {
      if (pathname === "/api/team-calendar/events" && req.method === "GET") {
        const session = sessionForRequest(req);
        if (!session) {
          sendText(res, 401, "未授权");
          return true;
        }
        sendJson(res, 200, {
          events: eventsForSubnet(session.subnetKey),
          serverTime: nowIso(),
        });
        return true;
      }

      if (pathname === "/api/team-calendar/events" && req.method === "POST") {
        const session = sessionForRequest(req);
        if (!session) {
          sendText(res, 401, "未授权");
          return true;
        }
        try {
          const payload = safeParseJson(await readBody(req)) || {};
          if (!requireCurrentSession(req, res, session)) return true;
          const title = safeText(payload.title).slice(0, 200);
          const start = safeText(payload.start);
          if (!validEventInput(payload)) {
            sendText(res, 400, "请提供有效标题和起止时间，结束时间不能早于开始时间");
            return true;
          }
          const store = loadCalendarStore();
          const event = normalizeTeamEvent({
            ...payload,
            id: crypto.randomUUID(),
            subnetKey: session.subnetKey,
            title,
            start,
            attendees: Array.isArray(payload.attendees)
              ? payload.attendees.map((a) => ({
                  ...a,
                  rsvp: safeText(a?.username) === session.username ? a.rsvp : "needs_action",
                }))
              : [],
            organizer: session.username,
            createdBy: session.username,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          });
          store.events.push(event);
          saveCalendarStore(store);
          broadcastToSubnet(session.subnetKey, {
            type: "calendar_event_created",
            event,
          });
          sendJson(res, 200, { event });
        } catch (err) {
          sendText(res, 500, err.message || "创建事件失败");
        }
        return true;
      }

      if (pathname.startsWith("/api/team-calendar/events/")) {
        const session = sessionForRequest(req);
        if (!session) {
          sendText(res, 401, "未授权");
          return true;
        }
        const rest = pathname.slice("/api/team-calendar/events/".length);
        const isRsvp = rest.endsWith("/rsvp");
        const eventId = decodeURIComponent(isRsvp ? rest.slice(0, -"/rsvp".length) : rest);

        if (isRsvp && req.method === "POST") {
          try {
            const payload = safeParseJson(await readBody(req)) || {};
            if (!requireCurrentSession(req, res, session)) return true;
            const status = normalizeRsvp(payload.status);
            const store = loadCalendarStore();
            const event = store.events.find(
              (e) => e.id === eventId && e.subnetKey === session.subnetKey,
            );
            if (!event) {
              sendText(res, 404, "事件不存在");
              return true;
            }
            const existing = event.attendees.find((a) => a.username === session.username);
            if (existing) {
              existing.rsvp = status;
            } else {
              event.attendees.push({
                username: session.username,
                displayName: session.displayName || session.username,
                rsvp: status,
              });
            }
            event.updatedAt = nowIso();
            saveCalendarStore(store);
            broadcastToSubnet(session.subnetKey, {
              type: "calendar_event_updated",
              event,
            });
            sendJson(res, 200, { event });
          } catch (err) {
            sendText(res, 500, err.message || "更新 RSVP 失败");
          }
          return true;
        }

        if (req.method === "PATCH") {
          try {
            const payload = safeParseJson(await readBody(req)) || {};
            if (!requireCurrentSession(req, res, session)) return true;
            const store = loadCalendarStore();
            const idx = store.events.findIndex(
              (e) => e.id === eventId && e.subnetKey === session.subnetKey,
            );
            if (idx < 0) {
              sendText(res, 404, "事件不存在");
              return true;
            }
            const prev = store.events[idx];
            if (prev.organizer !== session.username) {
              sendText(res, 403, "只有组织者可以编辑事件");
              return true;
            }
            if (
              !payload ||
              typeof payload !== "object" ||
              Array.isArray(payload) ||
              !validEventInput({ ...prev, ...payload }) ||
              (Object.hasOwn(payload, "attendees") && !Array.isArray(payload.attendees))
            ) {
              sendText(res, 400, "请提供有效标题、起止时间和参会人，结束时间不能早于开始时间");
              return true;
            }
            const merged = normalizeTeamEvent({
              ...prev,
              ...payload,
              attendees: Object.hasOwn(payload, "attendees")
                ? editAttendees(payload.attendees, prev.attendees)
                : prev.attendees,
              id: prev.id,
              subnetKey: prev.subnetKey,
              organizer: prev.organizer,
              createdBy: prev.createdBy,
              createdAt: prev.createdAt,
              updatedAt: nowIso(),
            });
            store.events[idx] = merged;
            saveCalendarStore(store);
            broadcastToSubnet(session.subnetKey, {
              type: "calendar_event_updated",
              event: merged,
            });
            sendJson(res, 200, { event: merged });
          } catch (err) {
            sendText(res, 500, err.message || "编辑事件失败");
          }
          return true;
        }

        if (req.method === "DELETE") {
          const store = loadCalendarStore();
          const idx = store.events.findIndex(
            (e) => e.id === eventId && e.subnetKey === session.subnetKey,
          );
          if (idx < 0) {
            sendText(res, 404, "事件不存在");
            return true;
          }
          if (store.events[idx].organizer !== session.username) {
            sendText(res, 403, "只有组织者可以删除事件");
            return true;
          }
          store.events.splice(idx, 1);
          saveCalendarStore(store);
          broadcastToSubnet(session.subnetKey, {
            type: "calendar_event_deleted",
            id: eventId,
          });
          sendJson(res, 200, { ok: true, id: eventId });
          return true;
        }
      }
    } catch (error) {
      sendText(res, 500, error.message || "团队日历资料暂不可用，原件已保留");
      return true;
    }
    return false;
  };
}

module.exports = { createTeamCalendarHandler };
