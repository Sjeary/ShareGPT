function normalizeHttpUrl(rawUrl, options = {}) {
  let value = String(rawUrl || "").trim();
  if (!value) return "";

  if (options.assumeHttps && !/^[a-z][a-z\d+.-]*:/i.test(value)) {
    value = `https://${value}`;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function isAllowedUrlForHosts(rawUrl, allowedHosts) {
  const normalized = normalizeHttpUrl(rawUrl);
  if (!normalized) return false;
  const url = new URL(normalized);
  return (allowedHosts || []).some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
  );
}

function isWorkspaceUrlAllowed(workspace, rawUrl) {
  if (!normalizeHttpUrl(rawUrl)) return false;
  if (workspace?.kind === "claude" && workspace?.allowExternalBrowsing) return true;
  return isAllowedUrlForHosts(rawUrl, workspace?.policy?.allowedHosts || []);
}

module.exports = {
  isAllowedUrlForHosts,
  isWorkspaceUrlAllowed,
  normalizeHttpUrl,
};
