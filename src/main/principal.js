const crypto = require("node:crypto");
const { URL } = require("node:url");

const LOCAL_PRINCIPAL_ID = "local-device";
const PRINCIPAL_ID_PATTERN = /^[a-f0-9]{64}$/;
const PRINCIPAL_ID_DOMAIN = "sharegpt-principal-v2";

function normalizeServerBaseUrl(rawUrl) {
  const raw = String(rawUrl || "").trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    raw.includes("?") ||
    raw.includes("#")
  ) {
    return "";
  }
  const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

function normalizePrincipalUsername(value) {
  const username = String(value ?? "");
  return username.trim() ? username : "";
}

function principalIdFor(serverUrl, username) {
  const serverBaseUrl = normalizeServerBaseUrl(serverUrl);
  const confirmedUsername = normalizePrincipalUsername(username);
  if (!serverBaseUrl || !confirmedUsername) return "";
  return crypto
    .createHash("sha256")
    .update(`${PRINCIPAL_ID_DOMAIN}\0${serverBaseUrl}\0${confirmedUsername}`, "utf8")
    .digest("hex");
}

function normalizePrincipalId(value, { allowLocal = false } = {}) {
  const id = String(value || "")
    .trim()
    .toLowerCase();
  if (allowLocal && id === LOCAL_PRINCIPAL_ID) return id;
  return PRINCIPAL_ID_PATTERN.test(id) ? id : "";
}

module.exports = {
  LOCAL_PRINCIPAL_ID,
  normalizePrincipalId,
  normalizePrincipalUsername,
  normalizeServerBaseUrl,
  principalIdFor,
};
