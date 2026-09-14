const fs = require("node:fs");
const crypto = require("node:crypto");
const { writeJsonAtomic } = require("./json_store");

// The key belongs to the deployment's data, never to its IP address or hostname.
function signLoginIdentity(file, user, nonce, users = []) {
  if (!/^[a-f0-9]{64}$/.test(String(nonce || ""))) {
    throw new Error("Invalid identity challenge");
  }
  let key;
  try {
    key = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (users.some((entry) => entry.identityUserId)) {
      throw new Error("Server identity missing; restore its data backup before login");
    }
    const pair = crypto.generateKeyPairSync("ed25519");
    key = {
      version: 1,
      privateKey: pair.privateKey.export({ format: "pem", type: "pkcs8" }),
    };
    writeJsonAtomic(file, key);
  }
  const privateKey = crypto.createPrivateKey(key.privateKey);
  if (key.version !== 1 || privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Invalid server identity key");
  }
  user.identityUserId ||= crypto.randomUUID();
  const publicKey = crypto
    .createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .toString("base64");
  const proof = {
    version: 1,
    nonce,
    username: user.username,
    userId: user.identityUserId,
    publicKey,
  };
  const message = JSON.stringify([
    "sharegpt-login-identity-v1",
    nonce,
    proof.username,
    proof.userId,
    publicKey,
  ]);
  return {
    ...proof,
    signature: crypto.sign(null, Buffer.from(message), privateKey).toString("base64"),
  };
}

module.exports = { signLoginIdentity };
