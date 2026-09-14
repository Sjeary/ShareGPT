// 知识库 vault 管理器 (主进程)。
// 职责: 把一个磁盘文件夹 (vault) 当作真源, 提供 .md/.canvas 等文本文件的增删改查 + 导入 + 外部改动监听。
// 解析/索引/图谱/搜索/同步/AI 全在渲染层 (那里有 markdown 库); 主进程只做文件 IO, 保持精简。
// 路径约定: 对渲染层一律用「相对 vault 根、正斜杠」的相对路径; 内部转成绝对路径并校验不越界。
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { readLocalJson, writeLocalJson } = require("../localJsonStore");

// 纳入 vault 的文本类扩展 (其余文件视为附件, 仅在导入时按需复制, 不进笔记列表)。
const TEXT_EXT = new Set([".md", ".markdown", ".canvas", ".base", ".txt"]);
const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
};
const IGNORED_DIRS = new Set([".obsidian", ".git", ".trash", "node_modules", "vault-cache"]);
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 单文件上限保护

function toPosix(p) {
  return p.split(path.sep).join("/");
}

class VaultManager {
  constructor(app, getWindow, options = {}) {
    this.app = app;
    this.getWindow = getWindow;
    this.dataRoot = options.dataRoot || app.getPath("userData");
    this.getSnapshot = options.getSnapshot || (() => null);
    this.isCurrent = options.isCurrent || (() => true);
    this.validateRoot = options.validateRoot || (() => {});
    this.metaFile = path.join(this.dataRoot, "vault-meta.json");
    this.root = this.#loadRoot();
    this.watcher = null;
    this.chokidar = null;
    this._emitTimer = null;
    this._pendingEvents = [];
    this._recentWrites = new Map(); // 抑制自身写入触发的回声: absPath -> 过期时间戳
    this.watchEpoch = 0;
  }

  // —— 根目录 ——
  #loadRoot() {
    const raw = readLocalJson(this.metaFile, null);
    const root =
      raw && typeof raw.root === "string" && raw.root
        ? raw.root
        : path.join(this.dataRoot, "ShareGPT-Vault");
    this.validateRoot(root);
    return root;
  }

  #saveRoot() {
    writeLocalJson(this.metaFile, { root: this.root });
  }

  #ensureRoot() {
    this.validateRoot(this.root);
    fs.mkdirSync(this.root, { recursive: true });
  }

  // The selected root may itself be a symlink (for example a user-managed vault alias).
  // Descendant links/junctions are excluded, as in list/import, so no file operation can
  // cross into another directory through an attachment or a pre-existing destination.
  #abs(relPath) {
    const clean = String(relPath || "").replace(/\\/g, "/");
    if (!clean || path.isAbsolute(clean) || /^[A-Za-z]:/.test(clean) || clean.includes("\0")) {
      throw new Error("非法知识库相对路径");
    }
    this.#ensureRoot();
    const rootResolved = fs.realpathSync(this.root);
    const abs = path.resolve(rootResolved, clean);
    if (abs === rootResolved || !abs.startsWith(rootResolved + path.sep)) {
      throw new Error("非法路径 (越出 vault 根): " + relPath);
    }
    let current = rootResolved;
    for (const segment of path.relative(rootResolved, abs).split(path.sep)) {
      if (process.platform === "win32" && segment.includes(":")) {
        throw new Error("不支持知识库文件的备用数据流");
      }
      current = path.join(current, segment);
      try {
        if (fs.lstatSync(current).isSymbolicLink()) {
          throw new Error("知识库内的符号链接或目录联接不能作为文件操作目标");
        }
      } catch (error) {
        if (error.code === "ENOENT") break;
        throw error;
      }
    }
    return abs;
  }

  getRoot() {
    return this.root;
  }

  #relative(absPath) {
    return toPosix(path.relative(fs.realpathSync(this.root), absPath));
  }

  async setRoot(absPath) {
    const next = String(absPath || "").trim();
    if (!next) throw new Error("路径为空");
    this.validateRoot(next);
    fs.mkdirSync(next, { recursive: true });
    const previous = this.root;
    this.root = next;
    try {
      this.#saveRoot();
    } catch (error) {
      this.root = previous;
      throw error;
    }
    await this.restartWatch();
    const files = await this.list();
    return { ok: true, root: this.root, count: files.length };
  }

  async pickFolder() {
    const { dialog } = require("electron");
    const win = this.getWindow();
    const res = await dialog.showOpenDialog(win || undefined, {
      title: "选择知识库文件夹 (vault)",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: this.root,
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  }

  // —— 列表 / 读 / 写 ——
  // 递归列出全部文本文件 (相对路径 + 时间戳)。
  async list() {
    this.#ensureRoot();
    const out = [];
    const walk = async (dir, relBase) => {
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        if (ent.isDirectory()) {
          if (IGNORED_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
          await walk(path.join(dir, ent.name), relBase ? `${relBase}/${ent.name}` : ent.name);
        } else if (ent.isFile()) {
          const ext = path.extname(ent.name).toLowerCase();
          if (!TEXT_EXT.has(ext)) continue;
          const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
          try {
            const st = await fsp.stat(path.join(dir, ent.name));
            out.push({
              path: rel,
              mtime: st.mtimeMs,
              ctime: st.birthtimeMs || st.ctimeMs,
              size: st.size,
            });
          } catch {}
        }
      }
    };
    await walk(this.root, "");
    return out;
  }

  // 读取全部文本文件内容 (供渲染层一次性建索引; 个人 vault 体量小, 可接受)。
  async readAll() {
    const metas = await this.list();
    const out = [];
    for (const m of metas) {
      try {
        const abs = this.#abs(m.path);
        const st = await fsp.stat(abs);
        if (st.size > MAX_FILE_BYTES) continue;
        const content = await fsp.readFile(abs, "utf-8");
        out.push({ path: m.path, content, mtime: st.mtimeMs, ctime: m.ctime });
      } catch {}
    }
    return out;
  }

  async read(relPath) {
    const abs = this.#abs(relPath);
    const st = await fsp.stat(abs);
    const content = await fsp.readFile(abs, "utf-8");
    return {
      path: this.#relative(abs),
      content,
      mtime: st.mtimeMs,
      ctime: st.birthtimeMs || st.ctimeMs,
    };
  }

  // 在库内按 basename 查首个匹配文件 (用于解析 ![[图片.png]] 这类只给文件名的附件引用)。
  async #findByName(name) {
    const target = String(name || "").toLowerCase();
    let found = null;
    const walk = async (dir) => {
      if (found) return;
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        if (found) return;
        if (ent.isDirectory()) {
          if (IGNORED_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
          await walk(path.join(dir, ent.name));
        } else if (ent.isFile() && ent.name.toLowerCase() === target) {
          found = path.join(dir, ent.name);
        }
      }
    };
    await walk(this.root);
    return found;
  }

  // 读二进制附件 (图片等) → dataURL, 供渲染层内联展示。relPath 可为相对路径或纯文件名。
  async readBinary(relPath) {
    let abs;
    try {
      abs = this.#abs(relPath);
      if (!fs.existsSync(abs)) abs = null;
    } catch {
      abs = null;
    }
    if (!abs) abs = await this.#findByName(path.basename(String(relPath || "")));
    if (!abs) return null;
    const st = await fsp.stat(abs);
    if (st.size > MAX_FILE_BYTES) return null;
    const buf = await fsp.readFile(abs);
    const mime = MIME[path.extname(abs).toLowerCase()] || "application/octet-stream";
    return { dataUrl: `data:${mime};base64,${buf.toString("base64")}`, mime };
  }

  #markWrite(abs) {
    this._recentWrites.set(abs, Date.now() + 1500);
  }

  // 原子写: tmp + rename。
  async write(relPath, content) {
    const abs = this.#abs(relPath);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp-${randomUUID()}`;
    try {
      await fsp.writeFile(tmp, String(content ?? ""), { encoding: "utf-8", flag: "wx" });
      this.#abs(relPath);
      await fsp.rename(tmp, abs);
    } finally {
      await fsp.unlink(tmp).catch(() => {});
    }
    this.#markWrite(abs);
    const st = await fsp.stat(abs);
    return { path: this.#relative(abs), mtime: st.mtimeMs };
  }

  async create(relPath, content = "") {
    const abs = this.#abs(relPath);
    if (fs.existsSync(abs)) throw new Error("文件已存在: " + relPath);
    await this.write(relPath, content);
    return this.read(relPath);
  }

  async rename(fromRel, toRel) {
    const from = this.#abs(fromRel);
    const to = this.#abs(toRel);
    if (!fs.existsSync(from)) throw new Error("源文件不存在");
    if (fs.existsSync(to)) throw new Error("目标已存在: " + toRel);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rename(from, to);
    this.#markWrite(from);
    this.#markWrite(to);
    return { ok: true };
  }

  async remove(relPath) {
    const abs = this.#abs(relPath);
    this.#markWrite(abs);
    await fsp.rm(abs, { force: true });
    return { ok: true };
  }

  // —— 导入外部 vault (文件夹) ——
  // 把外部文件夹里的 .md/.canvas/附件 复制进当前 vault (保留目录结构, 跳过 .obsidian 等)。
  async importFrom(srcDir) {
    const src = String(srcDir || "").trim();
    if (!src || !fs.existsSync(src)) throw new Error("源文件夹不存在");
    this.#ensureRoot();
    let notes = 0;
    let attachments = 0;
    let skipped = 0;
    const walk = async (dir, relBase) => {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const ent of entries) {
        const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
        if (ent.isDirectory()) {
          if (IGNORED_DIRS.has(ent.name)) continue;
          await walk(path.join(dir, ent.name), rel);
          continue;
        }
        if (!ent.isFile()) continue;
        const ext = path.extname(ent.name).toLowerCase();
        const srcAbs = path.join(dir, ent.name);
        try {
          const st = await fsp.stat(srcAbs);
          if (st.size > MAX_FILE_BYTES) {
            skipped++;
            continue;
          }
          const destAbs = this.#abs(rel);
          await fsp.mkdir(path.dirname(destAbs), { recursive: true });
          if (fs.existsSync(destAbs)) {
            skipped++;
            continue;
          }
          await fsp.copyFile(srcAbs, destAbs);
          this.#markWrite(destAbs);
          if (TEXT_EXT.has(ext)) notes++;
          else attachments++;
        } catch {
          skipped++;
        }
      }
    };
    await walk(src, "");
    await this.restartWatch();
    return { notes, attachments, skipped, root: this.root };
  }

  // —— 监听外部改动 (含用户同时开 Obsidian) ——
  async startWatch() {
    if (this.watcher) return;
    this.#ensureRoot();
    if (!this.chokidar) {
      try {
        this.chokidar = require("chokidar");
      } catch {
        return; // chokidar 不可用则降级为不监听 (手动刷新仍可用)
      }
    }
    const watchedRoot = this.root;
    const snapshot = this.getSnapshot();
    const epoch = ++this.watchEpoch;
    this.watcher = this.chokidar.watch(watchedRoot, {
      ignoreInitial: true,
      followSymlinks: false,
      depth: 12,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
      ignored: (p) => {
        const parts = p.split(path.sep);
        return parts.some((seg) => IGNORED_DIRS.has(seg));
      },
    });
    const onEvt = (type) => (abs) => {
      if (epoch !== this.watchEpoch || !this.isCurrent(snapshot)) return;
      const ext = path.extname(abs).toLowerCase();
      if (!TEXT_EXT.has(ext)) return;
      // 抑制自身写入回声
      const until = this._recentWrites.get(abs);
      if (until && until > Date.now()) return;
      const rel = toPosix(path.relative(watchedRoot, abs));
      this._pendingEvents.push({ type, path: rel });
      this.#scheduleEmit(snapshot, epoch);
    };
    this.watcher
      .on("add", onEvt("add"))
      .on("change", onEvt("change"))
      .on("unlink", onEvt("unlink"));
  }

  #scheduleEmit(snapshot, epoch) {
    if (this._emitTimer) return;
    this._emitTimer = setTimeout(() => {
      this._emitTimer = null;
      const events = this._pendingEvents.splice(0);
      if (epoch !== this.watchEpoch || !this.isCurrent(snapshot)) return;
      const win = this.getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send("vault:changed", { events, snapshot });
      }
    }, 300);
  }

  async restartWatch() {
    await this.stopWatch();
    await this.startWatch();
  }

  async stopWatch() {
    this.watchEpoch++;
    if (this._emitTimer) clearTimeout(this._emitTimer);
    this._emitTimer = null;
    this._pendingEvents = [];
    this._recentWrites.clear();
    if (this.watcher) {
      try {
        await this.watcher.close();
      } catch {}
      this.watcher = null;
    }
  }
}

module.exports = { VaultManager };
