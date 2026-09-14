// Frozen production declarations from ShareGPT v1.0.9 (b9a083e49c323544338d6eff12236275e1ba0c83).
// Extracted from the listed sources without behavior edits; only formatting is normalized.
// Only the request/send wrappers below bind runtime dependencies for an isolated protocol test.
// Keep this fixture frozen: new client code must not silently change old-client expectations.
export const SOURCE_PROVENANCE = {
  sha: "b9a083e49c323544338d6eff12236275e1ba0c83",
  files: [
    {
      path: "src/renderer-next/src/hooks/useAuth.ts",
      sha256: "9a6dc10aa12ab43e1ccffa99a3534a2f4b1d5108c0bc4301e0bf6379ad5096b7",
    },
    {
      path: "src/renderer-next/src/hooks/useChat.ts",
      sha256: "76537d4ed136c347385cd1d8df32e2303365ea89733f0fa87df324b8c1456cc2",
    },
    {
      path: "src/renderer-next/src/lib/collabLoginTransaction.ts",
      sha256: "5a6662cc335f4671b7a01580cdae55e9bb705150645f9b08b2f9e90ca454ae00",
    },
    {
      path: "src/renderer-next/src/hooks/clientBootstrap.ts",
      sha256: "bcc628338090e95b867d3dd8bf077389e9f58c69e746373d1b50d15b0c9d8977",
    },
    {
      path: "src/renderer-next/src/components/panels/service/helpers.ts",
      sha256: "5323212a882e5bf59e0f3110d2b5e4453dbf6a26aaf9dad08ca35476e336bc84",
    },
    {
      path: "src/renderer-next/src/lib/collabBootstrapAuthorization.ts",
      sha256: "480b854258a5d0cf621f060ad0da6ee5ab1907d5dc1ebca5f9f92c6e1d7c7921",
    },
    {
      path: "src/renderer-next/src/components/panels/account/bootstrap.ts",
      sha256: "d2dfbe640ff360cd25d035d945bd552f233eed7564432590affd5393f39ac46e",
    },
    {
      path: "src/renderer-next/src/components/panels/chat/normalize.ts",
      sha256: "76e2bf8cb8a155da2a8fd065226c45d51d072b22a7569ad730e4b5580d5e4caf",
    },
  ],
};
const api = { platform: "win32" };
const LOGIN_TIMEOUT_MS = 10000;
const BOOTSTRAP_TIMEOUT_MS = 10000;
async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("连接服务器超时，请检查服务地址或网络", { cause: err });
    }
    throw new Error("无法连接到服务器，请检查服务地址或网络", { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

export async function requireConfirmedLoginResponse<T extends ConfirmedLoginResponse>(
  response: Pick<Response, "ok" | "status" | "text" | "json">,
): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `登录失败（${response.status}）`);
  }

  const payload = (await response.json().catch(() => null)) as Partial<T> | null;
  if (!payload?.token) throw new Error("登录未成功，请稍后重试");
  if (typeof payload.username !== "string" || !payload.username.trim()) {
    throw new Error("服务器未返回已确认的账号身份");
  }
  return payload as T;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

async function fetchBootstrapRaw(serverUrl: string, token: string): Promise<unknown> {
  const cleaned = trimTrailingSlash(serverUrl.trim());
  if (!cleaned || !token) throw new Error("缺少协作服务器或登录凭据");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BOOTSTRAP_TIMEOUT_MS);
  try {
    const response = await fetch(`${cleaned}/api/client/bootstrap`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `读取客户端配置失败（${response.status}）`);
    }
    return await response.json().catch(() => null);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("读取线路授权超时，请检查服务地址或网络", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const GPT_ALLOWED_HOSTS = [
  "chatgpt.com",
  "openai.com",
  "auth0.com",
  "oaistatic.com",
  "oaiusercontent.com",
  "gravatar.com",
  "cloudflare.com",
  "wp.com",
];

const GEMINI_ALLOWED_HOSTS = [
  "gemini.google.com",
  "google.com",
  "googleapis.com",
  "googleusercontent.com",
  "gstatic.com",
  "gvt1.com",
  "googletagmanager.com",
];

const CLAUDE_ALLOWED_HOSTS = [
  "claude.ai",
  "anthropic.com",
  "claudeusercontent.com",
  "claudemcpcontent.com",
  "sentry.io",
  "stripe.com",
  "hcaptcha.com",
  "doubleclick.net",
  "datadoghq.com",
  "browser-intake-us5-datadoghq.com",
  "facebook.net",
  "intercom.io",
  "intercomcdn.com",
  // Claude artifacts / 代码运行加载的 CDN (jsDelivr / esm.sh)。
  "jsdelivr.net",
  "esm.sh",
];

const ENVIRONMENT_LOOKUP_HOSTS = ["ipwho.is"];

export const DEFAULT_TARGET_DOMAINS = [
  ...new Set([
    ...GPT_ALLOWED_HOSTS,
    ...GEMINI_ALLOWED_HOSTS,
    ...CLAUDE_ALLOWED_HOSTS,
    ...ENVIRONMENT_LOOKUP_HOSTS,
  ]),
].join(",");

function objectRecord(value: unknown): BootstrapRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as BootstrapRecord)
    : null;
}

export function hasAuthoritativeProxyBootstrap(raw: unknown): boolean {
  const payload = objectRecord(raw);
  if (!payload || !Array.isArray(payload.proxyRoutes)) return false;

  const capabilities = objectRecord(payload.capabilities);
  const proxyRoutes = objectRecord(capabilities?.proxyRoutes);
  if (!proxyRoutes) return true;

  return proxyRoutes.available === true && proxyRoutes.authoritative === true;
}

function hasCompleteLegacySender(payload: BootstrapRecord): boolean {
  const sender = objectRecord(payload.sender);
  return Boolean(sender?.proxy_server && sender?.proxy_port && sender?.proxy_uuid);
}

export function hasLegacyAdminProxyBootstrap(raw: unknown): boolean {
  const payload = objectRecord(raw);
  if (!payload || Array.isArray(payload.proxyRoutes)) return false;
  const capabilities = objectRecord(payload.capabilities);
  if (objectRecord(capabilities?.proxyRoutes)) return false;
  const airport = objectRecord(payload.airport);
  return hasCompleteLegacySender(payload) || Boolean(objectRecord(airport?.outbound));
}

function safeText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function currentUpdatePlatformKey(): "macos" | "windows" {
  return api.platform === "darwin" ? "macos" : "windows";
}

export function normalizeBootstrapPayload(
  raw: unknown,
  options: { allowLegacyAdminConfig?: boolean } = {},
): BootstrapPayload {
  const payload = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sender =
    payload.sender && typeof payload.sender === "object"
      ? (payload.sender as Record<string, unknown>)
      : {};
  const update =
    payload.update && typeof payload.update === "object"
      ? (payload.update as Record<string, unknown>)
      : {};
  const platformRaw = update[currentUpdatePlatformKey()];
  const platformUpdate =
    platformRaw && typeof platformRaw === "object" ? (platformRaw as Record<string, unknown>) : {};

  const airportRaw =
    payload.airport && typeof payload.airport === "object"
      ? (payload.airport as Record<string, unknown>)
      : null;
  const airportOutbound =
    airportRaw && airportRaw.outbound && typeof airportRaw.outbound === "object"
      ? (airportRaw.outbound as Record<string, unknown>)
      : null;
  const aiRoutingRaw =
    payload.aiRouting && typeof payload.aiRouting === "object"
      ? (payload.aiRouting as Record<string, unknown>)
      : {};
  const routeDefaultsRaw =
    aiRoutingRaw.defaultRouteByKind && typeof aiRoutingRaw.defaultRouteByKind === "object"
      ? (aiRoutingRaw.defaultRouteByKind as Record<string, unknown>)
      : {};
  const legacyAdminConfig =
    options.allowLegacyAdminConfig === true && hasLegacyAdminProxyBootstrap(payload);
  const proxyRoutesAuthoritative = hasAuthoritativeProxyBootstrap(payload) || legacyAdminConfig;
  const proxyRouteItems: unknown[] = Array.isArray(payload.proxyRoutes)
    ? (payload.proxyRoutes as unknown[])
    : [];
  const proxyRoutes = proxyRouteItems
    .map((item): BootstrapProxyRoute | null => {
      const route = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
      const id = safeText(route?.id).toLowerCase();
      const kind = safeText(route?.kind) === "unified" ? "unified" : "managed";
      const outbound =
        route?.outbound && typeof route.outbound === "object"
          ? (route.outbound as Record<string, unknown>)
          : undefined;
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || (kind === "managed" && !outbound)) return null;
      const expectedRaw =
        route?.expected && typeof route.expected === "object"
          ? (route.expected as Record<string, unknown>)
          : {};
      return {
        id,
        name: safeText(route?.name) || id,
        enabled: route?.enabled !== false,
        kind,
        outbound,
        expected: {
          ip: safeText(expectedRaw.ip),
          countryCode: safeText(expectedRaw.countryCode).toUpperCase(),
          asn: safeText(expectedRaw.asn),
        },
      };
    })
    .filter((route): route is BootstrapProxyRoute => Boolean(route));

  if (legacyAdminConfig && hasCompleteSenderBootstrap(sender)) {
    proxyRoutes.unshift({
      id: "internal-unified",
      name: "内置统一代理",
      enabled: true,
      kind: "unified",
    });
  }
  if (legacyAdminConfig && airportOutbound) {
    proxyRoutes.push({
      id: "internal-airport",
      name: safeText(airportRaw?.name) || "内置机场节点",
      enabled: true,
      kind: "managed",
      outbound: airportOutbound,
    });
  }

  return {
    proxyRoutes,
    proxyRoutesAuthoritative,
    aiRouting: {
      version: 1,
      defaultRouteByKind: {
        gpt: safeText(routeDefaultsRaw.gpt).toLowerCase(),
        gemini: safeText(routeDefaultsRaw.gemini).toLowerCase(),
        claude: safeText(routeDefaultsRaw.claude).toLowerCase(),
      },
      updatedAt: safeText(aiRoutingRaw.updatedAt),
    },
    airport: airportOutbound
      ? { name: safeText(airportRaw?.name), outbound: airportOutbound }
      : null,
    sender: {
      proxy_server: safeText(sender.proxy_server),
      proxy_port: safeText(sender.proxy_port),
      proxy_uuid: safeText(sender.proxy_uuid),
      socks_listen_port: safeText(sender.socks_listen_port),
      fallback_mode: safeText(sender.fallback_mode) || "system_proxy",
      fallback_local_port: safeText(sender.fallback_local_port),
      target_domains: safeText(sender.target_domains) || DEFAULT_TARGET_DOMAINS,
    },
    update: {
      version: safeText(update.version),
      notes: safeText(update.notes),
      publishedAt: safeText(update.publishedAt),
      url: safeText(platformUpdate.url),
      fileName: safeText(platformUpdate.fileName),
    },
  };
}

export function hasCompleteSenderBootstrap(
  sender: Partial<BootstrapSender> | undefined | null,
): boolean {
  return Boolean(
    safeText(sender?.proxy_server) && safeText(sender?.proxy_port) && safeText(sender?.proxy_uuid),
  );
}

function toWsUrl(httpUrl: string, token: string): string {
  const normalized = (httpUrl || "").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error("服务地址需要以 http:// 或 https:// 开头");
  }
  const base = normalized.startsWith("https://")
    ? `wss://${normalized.slice("https://".length)}/ws`
    : `ws://${normalized.slice("http://".length)}/ws`;
  return `${base}?token=${encodeURIComponent(token)}`;
}

function s(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function num(v: unknown): number {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function normalizeAttachments(items: unknown): ChatAttachment[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((raw): ChatAttachment | null => {
      const item = raw as Record<string, unknown>;
      const dataUrl = s(item?.dataUrl);
      if (!dataUrl) return null;
      return {
        kind: s(item?.kind) === "image" ? "image" : "file",
        name: s(item?.name).slice(0, 200) || "file",
        mime: s(item?.mime).slice(0, 200),
        size: num(item?.size),
        dataUrl,
      };
    })
    .filter((x): x is ChatAttachment => x !== null);
}

function normalizeReplyTarget(raw: unknown): ChatReplyTarget | null {
  const r = raw as Record<string, unknown> | null | undefined;
  const id = s(r?.id);
  if (!id) return null;
  return {
    id,
    from: s(r?.from ?? r?.username),
    displayName: s(r?.displayName ?? r?.username ?? r?.from) || "消息",
    preview: s(r?.preview).slice(0, 240) || "原消息",
    timestamp: s(r?.timestamp),
  };
}

export function normalizeReadBy(items: unknown): ReadReceiptUser[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const out: ReadReceiptUser[] = [];
  for (const raw of items) {
    const item = raw as Record<string, unknown> | null | undefined;
    const username = s(item?.username ?? item?.from);
    if (!username || seen.has(username)) continue;
    seen.add(username);
    out.push({
      username,
      displayName: s(item?.displayName ?? item?.username ?? item?.from) || username,
      readAt: s(item?.readAt ?? item?.timestamp) || new Date().toISOString(),
    });
  }
  return out.sort((a, b) => a.readAt.localeCompare(b.readAt));
}

function normalizeForwardedFrom(raw: unknown): ChatForwardedFrom | null {
  const r = raw as Record<string, unknown> | null | undefined;
  const from = s(r?.from ?? r?.username);
  if (!from) return null;
  return {
    from,
    displayName: s(r?.displayName ?? r?.username ?? r?.from) || "转发消息",
  };
}

export function normalizeChatMessage(raw: unknown): ChatMessage {
  const p = (raw ?? {}) as Record<string, unknown>;
  const scope: ChatScope = s(p.scope) === "private" ? "private" : "subnet";
  const from = s(p.from ?? p.username);
  const username = s(p.username ?? p.from) || "系统通知";
  const displayName = s(p.displayName) || username;
  const system = Boolean(p.system) || username === "系统通知";
  const recalled = Boolean(p.recalled);
  const edited = Boolean(p.edited);

  return {
    id: s(p.id),
    type: s(p.type) || (system ? "system" : "chat"),
    scope,
    from,
    to: s(p.to),
    username,
    displayName,
    avatar: s(p.avatar),
    text: s(p.text),
    attachments: normalizeAttachments(p.attachments),
    replyTo: normalizeReplyTarget(p.replyTo),
    forwardedFrom: normalizeForwardedFrom(p.forwardedFrom),
    timestamp: s(p.timestamp) || new Date().toISOString(),
    readAt: scope === "private" ? s(p.readAt) : "",
    readBy: scope === "subnet" ? normalizeReadBy(p.readBy) : [],
    edited,
    editedAt: edited ? s(p.editedAt) || new Date().toISOString() : "",
    subnetKey: s(p.subnetKey),
    subnetLabel: s(p.subnetLabel ?? p.roomScope),
    system,
    recalled,
    recalledAt: recalled ? s(p.recalledAt) || new Date().toISOString() : "",
    reactions:
      p.reactions && typeof p.reactions === "object"
        ? (p.reactions as Record<string, string[]>)
        : {},
  };
}
export async function legacyLogin(cleanedServer, cleanedUser, password, client) {
  const clientVersionPayload = async () => client;
  const response = await fetchWithTimeout(
    `${cleanedServer}/api/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: cleanedUser,
        password,
        client: await clientVersionPayload(),
      }),
    },
    LOGIN_TIMEOUT_MS,
  );
  return requireConfirmedLoginResponse(response);
}
export function bindLegacySend(ws) {
  const wsRef = { current: ws };
  return (input: SendMessageInput) => {
    const text = (input.text || "").trim();
    const attachments = input.attachments ?? [];
    if (!text && !attachments.length) return false;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("消息服务连接已断开，草稿已保留，请连接后重试。");
    }
    ws.send(
      JSON.stringify({
        type: "chat",
        scope: input.scope,
        to: input.scope === "private" ? input.to : "",
        text,
        replyTo: input.replyTo ?? null,
        attachments,
      }),
    );
    return true;
  };
}
export { fetchBootstrapRaw, toWsUrl };
