// 轻量结构化日志 (主进程)。零外部依赖、不向任何外部服务上传:
// 同时写控制台 + 本地文件 userData/logs/main.log (超过 5MB 自动轮转一份 .1)。
// 用法: const log = require("./logger").scoped("backend"); log.info("msg", obj)
const fs = require("node:fs");
const path = require("node:path");

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
let currentLevel = LEVELS[String(process.env.SHAREGPT_LOG_LEVEL || "info").toLowerCase()];
if (currentLevel === undefined) currentLevel = LEVELS.info;

let logFilePath = null;

function init(userDataDir) {
  try {
    const dir = path.join(userDataDir, "logs");
    fs.mkdirSync(dir, { recursive: true });
    const logFile = path.join(dir, "main.log");
    try {
      const st = fs.statSync(logFile);
      if (st.size > 5 * 1024 * 1024) {
        fs.renameSync(logFile, `${logFile}.1`);
      }
    } catch {
      /* 文件不存在或无法 stat: 忽略, 直接创建 */
    }
    logFilePath = logFile;
  } catch {
    logFilePath = null; // 文件不可写时退化为仅控制台
  }
}

function setLevel(level) {
  const v = LEVELS[String(level || "").toLowerCase()];
  if (v !== undefined) currentLevel = v;
}

function format(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function write(level, scope, args) {
  if ((LEVELS[level] ?? LEVELS.info) > currentLevel) return;
  const ts = new Date().toISOString();
  const line = `${ts} [${level.toUpperCase()}] [${scope}] ${args.map(format).join(" ")}`;
  const consoleFn =
    level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  consoleFn(line);
  if (logFilePath) {
    try {
      // 同步追加: 保证即使紧接着崩溃, 这条日志也已落盘 (崩溃诊断关键)。
      fs.appendFileSync(logFilePath, line + "\n");
    } catch {
      /* ignore write errors */
    }
  }
}

function scoped(scope) {
  return {
    error: (...a) => write("error", scope, a),
    warn: (...a) => write("warn", scope, a),
    info: (...a) => write("info", scope, a),
    debug: (...a) => write("debug", scope, a),
  };
}

module.exports = { init, setLevel, scoped };
