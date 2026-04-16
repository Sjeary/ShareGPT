const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const USERS_FILE = process.env.USERS_FILE || path.join(__dirname, "data", "users.json");
const ITERATIONS = 120000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

function ensureUserFile() {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2), "utf-8");
  }
}

function loadUsers() {
  ensureUserFile();
  try {
    const raw = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    if (!Array.isArray(raw.users)) return { users: [] };
    return raw;
  } catch {
    return { users: [] };
  }
}

function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
}

function upsertUser(username, password, avatar) {
  const store = loadUsers();
  const normalized = String(username || "").trim();
  const pwd = String(password || "");
  const avatarText = String(avatar || "").trim().slice(0, 64);

  if (!normalized) {
    throw new Error("用户名不能为空");
  }

  if (pwd.length < 6) {
    throw new Error("密码长度至少 6 位");
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(pwd, salt);
  const now = new Date().toISOString();

  const existing = store.users.find((item) => item.username === normalized);
  if (existing) {
    existing.salt = salt;
    existing.passwordHash = passwordHash;
    existing.iterations = ITERATIONS;
    existing.digest = DIGEST;
    existing.avatar = avatarText || existing.avatar || "";
    existing.disabled = false;
    existing.updatedAt = now;
    saveUsers(store);
    return { updated: true, username: normalized };
  }

  store.users.push({
    username: normalized,
    salt,
    passwordHash,
    iterations: ITERATIONS,
    digest: DIGEST,
    avatar: avatarText,
    disabled: false,
    createdAt: now,
    updatedAt: now,
  });
  saveUsers(store);
  return { updated: false, username: normalized };
}

function main() {
  const [, , username, password, avatar] = process.argv;
  if (!username || !password) {
    console.error("用法: node add_user.js <username> <password> [avatar]");
    process.exit(1);
  }

  const result = upsertUser(username, password, avatar);
  const action = result.updated ? "已更新" : "已创建";
  console.log(`${action}账号: ${result.username}`);
  console.log(`用户文件: ${USERS_FILE}`);
}

main();
