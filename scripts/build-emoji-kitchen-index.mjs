// 生成精简版 Emoji Kitchen 索引 (有效组合对 → 日期码), 供渲染层直连 Google gstatic 取组合图。
// 源数据: xsalazar/emoji-kitchen-backend metadata.json (~98MB)。产物 ~3MB, 提交进仓库随包发布。
// 用法: node scripts/build-emoji-kitchen-index.mjs   (偶尔手动跑一次刷新即可)
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(
  __dirname,
  "..",
  "src",
  "renderer-next",
  "src",
  "assets",
  "emoji-kitchen-index.json",
);
const SRC =
  "https://raw.githubusercontent.com/xsalazar/emoji-kitchen-backend/main/app/metadata.json";

function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.headers.location) {
          download(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      })
      .on("error", reject);
  });
}

const raw = await download(SRC);
console.log(`downloaded ${(raw.length / 1048576).toFixed(1)}MB`);
const meta = JSON.parse(raw);
const data = meta.data || {};

const dateList = [];
const dateIdx = new Map();
const pairs = {};
for (const k of Object.keys(data)) {
  const combos = data[k].combinations || {};
  for (const ck of Object.keys(combos)) {
    const list = Array.isArray(combos[ck]) ? combos[ck] : [combos[ck]];
    for (const c of list) {
      if (!c || !c.isLatest) continue;
      const L = c.leftEmojiCodepoint;
      const R = c.rightEmojiCodepoint;
      const d = c.date;
      if (!L || !R || !d) continue;
      if (!dateIdx.has(d)) {
        dateIdx.set(d, dateList.length);
        dateList.push(d);
      }
      pairs[`${L}_${R}`] = dateIdx.get(d);
    }
  }
}

const out = { dates: dateList, pairs };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out), "utf-8");
const bytes = fs.statSync(OUT).size;
console.log(
  `wrote ${OUT}\n  pairs=${Object.keys(pairs).length} dates=${dateList.length} size=${(bytes / 1048576).toFixed(2)}MB`,
);
