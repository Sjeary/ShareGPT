const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function atomicReplace(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(fd, text, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
function readValidated(file, validate) {
  const text = fs.readFileSync(file, "utf8");
  const value = JSON.parse(text);
  if (!validate(value)) throw new Error("数据结构不合法");
  return { text, value };
}

function readLocalJson(file, fallback, validate = isObject) {
  try {
    return readValidated(file, validate).value;
  } catch (primaryError) {
    // Permission and filesystem errors are not evidence of a corrupt or missing file.
    if (primaryError.code && primaryError.code !== "ENOENT") throw primaryError;
    try {
      const backup = readValidated(`${file}.bak`, validate);
      if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.corrupt-${randomUUID()}`);
      atomicReplace(file, backup.text);
      return backup.value;
    } catch (backupError) {
      if (primaryError.code === "ENOENT" && backupError.code === "ENOENT")
        return structuredClone(fallback);
      throw Object.assign(
        new Error(`无法读取 ${path.basename(file)}，原文件已保留，请恢复有效备份`, {
          cause: primaryError,
        }),
        {
          code: "LOCAL_STORE_UNAVAILABLE",
        },
      );
    }
  }
}

function writeLocalJson(
  file,
  value,
  validate = isObject,
  { transformPrevious = (previous) => previous } = {},
) {
  if (!validate(value)) throw new Error("数据结构不合法");
  const text = JSON.stringify(value, null, 2);
  // Validate/recover existing data before touching either the primary or its backup.
  const previous = readLocalJson(file, null, validate);
  if (previous !== null) {
    const backup = transformPrevious(previous);
    if (!validate(backup)) throw new Error("备份数据结构不合法");
    atomicReplace(`${file}.bak`, JSON.stringify(backup, null, 2));
  }
  atomicReplace(file, text);
  return value;
}

module.exports = { readLocalJson, writeLocalJson, atomicReplace };
