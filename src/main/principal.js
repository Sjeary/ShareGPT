const crypto = require("node:crypto");
const { URL } = require("node:url");

const LOCAL_PRINCIPAL_ID = "local-device";
const PRINCIPAL_ID_PATTERN = /^[a-f0-9]{64}$/;

function normalizeServerOrigin(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || "").trim());
  } catch {
    return "";
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    return "";
  }
  return url.origin.toLowerCase();
}

function normalizePrincipalUsername(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
}

function principalIdFor(serverUrl, username) {
  const origin = normalizeServerOrigin(serverUrl);
  const normalizedUsername = normalizePrincipalUsername(username);
  if (!origin || !normalizedUsername) return "";
  return crypto
    .createHash("sha256")
    .update(`${origin}\0${normalizedUsername}`, "utf8")
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
  normalizeServerOrigin,
  principalIdFor,
};
