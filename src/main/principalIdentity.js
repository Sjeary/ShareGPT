const crypto = require("node:crypto");
const { principalIdFor, normalizePrincipalId, normalizeServerBaseUrl } = require("./principal");

function verifiedIdentity(proof, nonce, username) {
  if (
    !proof ||
    proof.version !== 1 ||
    proof.nonce !== nonce ||
    proof.username !== username ||
    !/^[a-f0-9]{64}$/.test(String(nonce || "")) ||
    !/^[a-f0-9-]{36}$/.test(String(proof.userId || "")) ||
    typeof proof.publicKey !== "string" ||
    proof.publicKey.length > 128 ||
    typeof proof.signature !== "string" ||
    proof.signature.length > 128
  ) {
    throw new Error("服务器身份验证失败");
  }
  const bytes = Buffer.from(proof.publicKey, "base64");
  const publicKey = crypto.createPublicKey({ key: bytes, format: "der", type: "spki" });
  const message = JSON.stringify([
    "sharegpt-login-identity-v1",
    nonce,
    username,
    proof.userId,
    proof.publicKey,
  ]);
  if (
    publicKey.asymmetricKeyType !== "ed25519" ||
    !crypto.verify(null, Buffer.from(message), publicKey, Buffer.from(proof.signature, "base64"))
  ) {
    throw new Error("服务器身份签名不匹配");
  }
  return `${crypto.createHash("sha256").update(bytes).digest("hex")}:${proof.userId}`;
}

// Resolve to the existing storage owner. Never rename/copy Chromium partitions.
function resolvePrincipalIdentity(state, serverUrl, username, options = {}) {
  const addressId = principalIdFor(serverUrl, username);
  if (!addressId) throw new Error("协作账号 principal 信息不合法");
  const alias = state.endpointAliases?.[addressId];
  const addressOwner = alias ? normalizePrincipalId(alias.principalId) : addressId;
  if (!addressOwner || (alias && alias.username !== username))
    throw new Error("服务器地址关联无效");
  const pinned = state.identityByPrincipal?.[addressOwner];
  if (!options.proof) {
    if (pinned)
      throw new Error("此服务器曾提供身份验证，当前响应缺少身份证明，请检查服务器版本或入口");
    return { principalId: addressOwner, changed: false };
  }
  const identity = verifiedIdentity(options.proof, options.nonce, username);
  if (pinned && pinned !== identity)
    throw new Error("服务器或账号身份已改变，已保留原有本地数据并停止接续");
  const knownOwner = normalizePrincipalId(state.principalByIdentity?.[identity]);
  const principalId = knownOwner || addressOwner;
  const knownUser = state.byPrincipal?.[principalId]?.ownerUsername;
  if (knownUser && knownUser !== username)
    throw new Error("账号名称与原有数据不匹配，需要显式迁移");
  if (alias && knownOwner && knownOwner !== addressOwner)
    throw new Error("服务器身份与手动迁移目标冲突");
  state.identityByPrincipal = { ...state.identityByPrincipal, [principalId]: identity };
  state.principalByIdentity = { ...state.principalByIdentity, [identity]: principalId };
  state.endpointAliases = { ...state.endpointAliases, [addressId]: { principalId, username } };
  return { principalId, changed: true };
}

// Explicit offline migration only. The destination's previous data stays untouched.
function linkPrincipalEndpoint(state, sourceUrl, destinationUrl, username) {
  const sourceId = principalIdFor(sourceUrl, username);
  const destinationId = principalIdFor(destinationUrl, username);
  const source = state.byPrincipal?.[sourceId];
  if (
    !sourceId ||
    !destinationId ||
    sourceId === destinationId ||
    source?.ownerUsername !== username ||
    normalizeServerBaseUrl(source?.ownerServer) !== normalizeServerBaseUrl(sourceUrl)
  ) {
    throw new Error("原服务器和账号的本地数据不匹配");
  }
  if (
    state.identityByPrincipal?.[destinationId] &&
    state.identityByPrincipal[destinationId] !== state.identityByPrincipal?.[sourceId]
  ) {
    throw new Error("目标地址已有不同的服务器身份，禁止覆盖");
  }
  if (
    state.endpointAliases?.[destinationId] &&
    state.endpointAliases[destinationId].principalId !== sourceId
  ) {
    throw new Error("目标地址已关联其他数据，禁止覆盖");
  }
  state.endpointAliases = {
    ...state.endpointAliases,
    [destinationId]: { principalId: sourceId, username },
  };
  return { sourceId, destinationId };
}

module.exports = { verifiedIdentity, resolvePrincipalIdentity, linkPrincipalEndpoint };
