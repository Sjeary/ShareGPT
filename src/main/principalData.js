const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { normalizePrincipalId } = require("./principal");
const { readLocalJson, writeLocalJson } = require("./localJsonStore");

const CATEGORIES = Object.freeze({
  calendar: "calendar.json",
  tasks: "tasks.json",
  focus: "focus.json",
  chat: "chat_history.json",
  notes: "ShareGPT-Vault",
});
const OBJECT = (value) => value && typeof value === "object" && !Array.isArray(value);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code, message) => Object.assign(new Error(message), { code });
const defaultCalendar = {
  id: "default-personal",
  name: "个人",
  color: "#3b82f6",
  visible: true,
  isDefault: true,
};
const defaultList = {
  id: "default-inbox",
  name: "收件箱",
  color: "#8e8e93",
  isInbox: true,
  sortOrder: 0,
};
const defaultFocus = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  longEvery: 4,
  autoStart: false,
  sound: "none",
  currentTaskId: null,
};

function plainStat(file) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink())
      throw fail("LEGACY_LINK_REJECTED", "资料中含符号链接或目录联接，请先确认导入范围");
    return stat;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function validJson(category, value) {
  if (!OBJECT(value)) return false;
  const arrays = {
    calendar: ["calendars", "events"],
    tasks: ["lists", "tasks", "memos"],
    focus: ["sessions"],
  };
  if (category === "chat")
    return OBJECT(value.conversations) && Object.values(value.conversations).every(Array.isArray);
  return (
    arrays[category]?.every((key) => value[key] === undefined || Array.isArray(value[key])) &&
    arrays[category].some((key) => Array.isArray(value[key]))
  );
}

function sameDefault(value, defaults) {
  return (
    OBJECT(value) &&
    Object.keys(value).every(
      (key) => Object.hasOwn(defaults, key) && value[key] === defaults[key],
    ) &&
    value.id === defaults.id
  );
}

function emptyDefault(category, value) {
  if (!validJson(category, value)) return false;
  if (value.deleted && (!OBJECT(value.deleted) || Object.keys(value.deleted).length)) return false;
  const known = new Set([
    "version",
    "updatedAt",
    "deleted",
    ...({
      calendar: ["calendars", "events"],
      tasks: ["lists", "tasks", "memos"],
      focus: ["sessions", "settings"],
      chat: ["conversations"],
    }[category] || []),
  ]);
  if (Object.keys(value).some((key) => !known.has(key))) return false;
  if (category === "calendar")
    return (
      !(value.events || []).length &&
      (value.calendars || []).every((record) => sameDefault(record, defaultCalendar)) &&
      (value.calendars || []).length <= 1
    );
  if (category === "tasks")
    return (
      !(value.tasks || []).length &&
      !(value.memos || []).length &&
      (value.lists || []).every((record) => sameDefault(record, defaultList)) &&
      (value.lists || []).length <= 1
    );
  if (category === "focus")
    return (
      !(value.sessions || []).length &&
      (!value.settings ||
        (OBJECT(value.settings) &&
          Object.entries(value.settings).every(
            ([key, field]) => Object.hasOwn(defaultFocus, key) && field === defaultFocus[key],
          )))
    );
  return Object.keys(value.conversations).length === 0;
}

function fileDigest(file) {
  const digest = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let length;
    while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0)
      digest.update(buffer.subarray(0, length));
  } finally {
    fs.closeSync(fd);
  }
  return digest.digest("hex");
}

function flushCopiedFile(file) {
  const fd = fs.openSync(file, "r+");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function treeManifest(root) {
  const entries = [];
  const walk = (directory, prefix = "") => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name),
        relative = prefix ? `${prefix}/${name}` : name;
      const stat = plainStat(file);
      if (!stat) throw fail("LEGACY_SOURCE_CHANGED", "旧资料已变化，请重新查看后确认");
      if (stat.isDirectory()) {
        entries.push({ path: relative, directory: true });
        walk(file, relative);
      } else if (stat.isFile())
        entries.push({ path: relative, bytes: stat.size, hash: fileDigest(file) });
      else throw fail("LEGACY_FILE_REJECTED", "旧资料包含不支持的特殊文件");
    }
  };
  walk(root);
  return entries;
}

function validLedger(value) {
  return (
    value?.version === 1 &&
    OBJECT(value.categories) &&
    Object.entries(value.categories).every(
      ([category, record]) =>
        (Object.hasOwn(CATEGORIES, category) || /^chat:[a-f0-9]{64}$/.test(category)) &&
        OBJECT(record) &&
        Boolean(record.principalId) &&
        normalizePrincipalId(record.principalId, { allowLocal: true }) === record.principalId &&
        /^[a-f0-9]{64}$/.test(record.fingerprint) &&
        /^[a-f0-9]{64}$/.test(record.targetFingerprint) &&
        ["pending", "done"].includes(record.state),
    )
  );
}

class PrincipalData {
  constructor(userDataRoot) {
    this.root = fs.realpathSync(userDataRoot);
    this.ledgerFile = path.join(this.root, "legacy-data-imports.json");
  }

  directory(principalId) {
    const id = normalizePrincipalId(principalId, { allowLocal: true });
    if (!id || id !== principalId) throw fail("INVALID_DATA_PRINCIPAL", "资料账号身份无效");
    const base = path.join(this.root, "PrincipalData");
    plainStat(base);
    const directory = path.join(base, id);
    plainStat(directory);
    return directory;
  }

  file(principalId, category) {
    if (!Object.hasOwn(CATEGORIES, category) || category === "notes")
      throw fail("INVALID_DATA_CATEGORY", "资料类别无效");
    const target = path.join(this.directory(principalId), CATEGORIES[category]);
    plainStat(target);
    plainStat(`${target}.bak`);
    return target;
  }

  vaultDirectory(principalId) {
    const target = path.join(this.directory(principalId), CATEGORIES.notes);
    plainStat(target);
    return target;
  }

  #ledger() {
    plainStat(this.ledgerFile);
    plainStat(`${this.ledgerFile}.bak`);
    return readLocalJson(this.ledgerFile, { version: 1, categories: {} }, validLedger);
  }

  #source(principalId, category, options = { group: undefined }) {
    if (!Object.hasOwn(CATEGORIES, category)) throw fail("INVALID_DATA_CATEGORY", "资料类别无效");
    if (category === "notes") {
      const meta = path.join(this.root, "vault-meta.json");
      const metaStat = plainStat(meta);
      const metaBytes = metaStat ? fs.readFileSync(meta) : null;
      const selectedRoot = metaBytes ? JSON.parse(metaBytes.toString("utf8"))?.root : "";
      const source = selectedRoot
        ? path.resolve(selectedRoot)
        : path.join(this.root, CATEGORIES.notes);
      const stat = plainStat(source);
      if (!stat) return null;
      if (!stat.isDirectory()) throw fail("LEGACY_INVALID", "旧笔记目录无效");
      const canonical = fs.realpathSync(source);
      const scopedRoot = path.join(this.root, "PrincipalData");
      const contains = (parent, child) => {
        const relative = path.relative(parent, child);
        return (
          relative === "" ||
          (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
        );
      };
      if (contains(canonical, scopedRoot) || contains(scopedRoot, canonical))
        throw fail("LEGACY_INVALID", "旧笔记来源不能包含或位于账号资料目录中");
      const entries = treeManifest(canonical);
      const targetFingerprint = hash(JSON.stringify(entries));
      return {
        source: canonical,
        entries,
        bytes: entries.reduce((sum, entry) => sum + (entry.bytes || 0), 0),
        fileCount: entries.filter((entry) => !entry.directory).length,
        targetFingerprint,
        fingerprint: hash(
          JSON.stringify({
            principalId,
            category,
            source: canonical,
            meta: metaBytes && hash(metaBytes),
            entries,
          }),
        ),
      };
    }
    const primary = path.join(this.root, CATEGORIES[category]);
    const candidates = [primary, `${primary}.bak`].map((file) => {
      const stat = plainStat(file);
      if (!stat) return { file, bytes: null, digest: null, value: null };
      if (!stat.isFile()) throw fail("LEGACY_INVALID", "旧资料路径不是文件");
      const bytes = fs.readFileSync(file);
      let value;
      try {
        value = JSON.parse(bytes.toString("utf8"));
      } catch {
        value = null;
      }
      return { file, bytes, digest: hash(bytes), value: validJson(category, value) ? value : null };
    });
    const selected = candidates.find((candidate) => candidate.value);
    if (!selected) {
      if (candidates.some((candidate) => candidate.bytes))
        throw fail("LEGACY_INVALID", "旧资料和备份均无法读取，原件已保留");
      return null;
    }
    let content = selected.bytes;
    let groups;
    if (category === "chat") {
      const conversations = selected.value.conversations;
      const split = (key) => {
        const index = key.indexOf("\0");
        return index < 0
          ? { group: "", conversation: key }
          : { group: key.slice(0, index), conversation: key.slice(index + 1) };
      };
      groups = [...new Set(Object.keys(conversations).map((key) => split(key).group))].sort();
      if (typeof options.group === "string") {
        if (!groups.includes(options.group))
          throw fail("LEGACY_SOURCE_CHANGED", "所选聊天来源不存在，请重新查看后确认");
        const chosen = Object.create(null);
        for (const [key, messages] of Object.entries(conversations)) {
          const entry = split(key);
          if (entry.group === options.group) {
            if (!entry.conversation || Object.hasOwn(chosen, entry.conversation))
              throw fail("LEGACY_INVALID", "聊天会话标识存在冲突，未合并覆盖");
            chosen[entry.conversation] = messages;
          }
        }
        content = Buffer.from(
          JSON.stringify({ ...selected.value, conversations: chosen }, null, 2),
        );
      }
    }
    return {
      source: selected.file,
      content,
      groups,
      bytes: content.length,
      fileCount: 1,
      targetFingerprint: hash(content),
      fingerprint: hash(
        JSON.stringify({
          principalId,
          category,
          group: category === "chat" ? options.group : undefined,
          selected: selected.file,
          candidates: candidates.map((candidate) => [candidate.file, candidate.digest]),
        }),
      ),
    };
  }

  #target(principalId, category) {
    return category === "notes"
      ? this.vaultDirectory(principalId)
      : this.file(principalId, category);
  }

  #emptyTarget(principalId, category, target) {
    if (category === "notes") {
      const meta = path.join(this.directory(principalId), "vault-meta.json");
      if (plainStat(meta)) {
        const customRoot = JSON.parse(fs.readFileSync(meta, "utf8"))?.root;
        if (customRoot && path.resolve(customRoot) !== target)
          throw fail(
            "LEGACY_CUSTOM_VAULT",
            "当前账号使用自选知识库，请先切换回默认知识库再接续旧资料",
          );
      }
      if (plainStat(target) && fs.readdirSync(target).length)
        throw fail("LEGACY_TARGET_NOT_EMPTY", "当前账号已有笔记，不能覆盖接续");
      return;
    }
    for (const file of [target, `${target}.bak`]) {
      if (!plainStat(file)) continue;
      let value;
      try {
        value = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        throw fail("LEGACY_TARGET_NOT_EMPTY", "当前账号资料无法读取，不能覆盖接续");
      }
      if (!emptyDefault(category, value))
        throw fail("LEGACY_TARGET_NOT_EMPTY", "当前账号已有资料，不能覆盖接续");
    }
  }

  #targetMatches(target, category, fingerprint) {
    if (!plainStat(target)) return false;
    return (
      (category === "notes" ? hash(JSON.stringify(treeManifest(target))) : fileDigest(target)) ===
      fingerprint
    );
  }

  #claimKey(category, options = { group: undefined }) {
    if (category !== "chat") return category;
    if (typeof options.group !== "string")
      throw fail("LEGACY_CHAT_GROUP_REQUIRED", "请明确选择旧聊天的来源服务器");
    return `chat:${hash(options.group)}`;
  }

  #inspectCategory(principalId, category, ledger, options = { group: undefined }) {
    try {
      const claim = ledger.categories[this.#claimKey(category, options)];
      const target = this.#target(principalId, category);
      if (
        claim?.state === "pending" &&
        claim.principalId === principalId &&
        this.#targetMatches(target, category, claim.targetFingerprint)
      ) {
        return {
          category,
          available: true,
          canImport: true,
          reason: "resume",
          fingerprint: claim.fingerprint,
          bytes: 0,
          fileCount: 0,
        };
      }
      const source = this.#source(principalId, category, options);
      if (claim?.state === "done" || (claim && claim.principalId !== principalId))
        return {
          category,
          available: Boolean(source),
          canImport: false,
          reason: "already-imported",
          fingerprint: "",
          bytes: source?.bytes || 0,
          fileCount: source?.fileCount || 0,
        };
      if (!source)
        return {
          category,
          available: false,
          canImport: false,
          reason: "not-found",
          fingerprint: "",
          bytes: 0,
          fileCount: 0,
        };
      if (
        !(
          claim?.state === "pending" &&
          this.#targetMatches(target, category, claim.targetFingerprint)
        )
      )
        this.#emptyTarget(principalId, category, target);
      return {
        category,
        available: true,
        canImport: true,
        reason: claim ? "resume" : "",
        fingerprint:
          claim && this.#targetMatches(target, category, claim.targetFingerprint)
            ? claim.fingerprint
            : source.fingerprint,
        bytes: source.bytes,
        fileCount: source.fileCount,
        sourcePath: source.source,
      };
    } catch (error) {
      return {
        category,
        available: true,
        canImport: false,
        reason: error.code || "LEGACY_INVALID",
        message: error.message,
        fingerprint: "",
        bytes: 0,
        fileCount: 0,
      };
    }
  }

  inspectLegacy(principalId) {
    this.directory(principalId);
    const ledger = this.#ledger();
    return Object.keys(CATEGORIES).map((category) => {
      if (category !== "chat") return this.#inspectCategory(principalId, category, ledger);
      try {
        const source = this.#source(principalId, category);
        const groups = (source?.groups || []).map((group) => ({
          ...this.#inspectCategory(principalId, category, ledger, { group }),
          group,
          label: group || "未标注来源",
        }));
        return {
          category,
          groups,
          available: Boolean(source),
          canImport: groups.some((group) => group.canImport),
          bytes: source?.bytes || 0,
          fileCount: source?.fileCount || 0,
          fingerprint: "",
          reason: source ? "select-chat-group" : "not-found",
        };
      } catch (error) {
        return {
          category,
          groups: [],
          available: true,
          canImport: false,
          reason: error.code || "LEGACY_INVALID",
          message: error.message,
          fingerprint: "",
          bytes: 0,
          fileCount: 0,
        };
      }
    });
  }

  importLegacy(principalId, category, fingerprint, options = { group: undefined }) {
    this.directory(principalId);
    const claimKey = this.#claimKey(category, options);
    const ledger = this.#ledger(),
      claim = ledger.categories[claimKey];
    if (claim?.state === "done" || (claim && claim.principalId !== principalId))
      throw fail("LEGACY_ALREADY_IMPORTED", "这类旧资料已接续到账号，不能重复认领");
    const target = this.#target(principalId, category);
    if (
      claim &&
      claim.fingerprint === fingerprint &&
      this.#targetMatches(target, category, claim.targetFingerprint)
    ) {
      ledger.categories[claimKey] = { ...claim, state: "done" };
      writeLocalJson(this.ledgerFile, ledger, validLedger);
      return { category, imported: true, resumed: true };
    }
    const source = this.#source(principalId, category, options);
    if (!source || source.fingerprint !== fingerprint)
      throw fail("LEGACY_SOURCE_CHANGED", "旧资料或目标账号已变化，请重新查看后确认");
    this.#emptyTarget(principalId, category, target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const stage = `${target}.import-${randomUUID()}`;
    try {
      if (category === "notes") {
        fs.mkdirSync(stage);
        for (const entry of source.entries) {
          const destination = path.join(stage, entry.path);
          if (entry.directory) fs.mkdirSync(destination, { recursive: true });
          else {
            plainStat(path.join(source.source, entry.path));
            fs.copyFileSync(
              path.join(source.source, entry.path),
              destination,
              fs.constants.COPYFILE_EXCL,
            );
            flushCopiedFile(destination);
          }
        }
      } else {
        fs.writeFileSync(stage, source.content, { flag: "wx", mode: 0o600 });
        flushCopiedFile(stage);
      }
      if (
        !this.#targetMatches(stage, category, source.targetFingerprint) ||
        this.#source(principalId, category, options)?.fingerprint !== fingerprint
      )
        throw fail("LEGACY_SOURCE_CHANGED", "复制期间旧资料发生变化，未覆盖当前资料");
      this.#emptyTarget(principalId, category, target);
      const pending = {
        principalId,
        ...(category === "chat" ? { group: options.group } : {}),
        fingerprint,
        targetFingerprint: source.targetFingerprint,
        state: "pending",
        requestedAt: new Date().toISOString(),
      };
      ledger.categories[claimKey] = pending;
      writeLocalJson(this.ledgerFile, ledger, validLedger);
      if (category === "notes" && plainStat(target)) fs.rmdirSync(target);
      fs.renameSync(stage, target);
      ledger.categories[claimKey] = { ...pending, state: "done" };
      writeLocalJson(this.ledgerFile, ledger, validLedger);
      return { category, imported: true, resumed: Boolean(claim) };
    } finally {
      if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
    }
  }
}

module.exports = { PrincipalData };
