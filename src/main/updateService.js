const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { URL } = require("node:url");
const { buildUpdateReleaseInfo } = require("./updateRelease");

function deriveUpdateRepo() {
  try {
    const pkg = require("../../package.json");
    const src = String(
      pkg.homepage || (pkg.repository && (pkg.repository.url || pkg.repository)) || "",
    );
    const m = src.match(/github\.com[/:]+([^/]+\/[^/.\s]+)/i);
    return m ? m[1] : "";
  } catch (_err) {
    return "";
  }
}

class UpdateService {
  constructor({
    directory,
    repo = deriveUpdateRepo(),
    getProxyState = () => ({ running: false, port: null }),
  }) {
    this.updatesDir = directory;
    this.repo = repo;
    this.getProxyState = getProxyState;
  }
  sanitizeUpdateFileName(rawName, fallbackExt = "") {
    const source = String(rawName || "").trim();
    const cleaned = path
      .basename(source)
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
      .trim();
    if (cleaned) return cleaned;
    return `ShareGPT-update${fallbackExt}`;
  }

  resolveUpdateDownloadTarget(rawUrl, preferredName = "", version = "") {
    let parsed;
    try {
      parsed = new URL(String(rawUrl || "").trim());
    } catch {
      throw new Error("更新链接无效");
    }

    if (parsed.protocol !== "https:") {
      throw new Error("更新链接仅支持 GitHub HTTPS");
    }

    const ext = path.extname(parsed.pathname || "");
    const originalName = this.sanitizeUpdateFileName(
      preferredName || path.basename(parsed.pathname || ""),
      ext,
    );
    const originalExt = path.extname(originalName) || ext;
    const originalBase = path.basename(originalName, originalExt);
    const stamp = new Date().toISOString().replace(/[^\d]/g, "").slice(0, 14);
    const fileName = this.sanitizeUpdateFileName(
      `${originalBase}-${stamp}${originalExt}`,
      originalExt,
    );
    const versionText = String(version || "").trim();
    const versionDir = versionText ? this.sanitizeUpdateFileName(`v${versionText}`, "") : "manual";
    return {
      url: parsed,
      filePath: path.join(this.updatesDir, versionDir, fileName),
    };
  }

  // GET 文本 (读 release 的 latest.yml), 跟随重定向 (releases/latest/download -> CDN)。失败返回 null。
  // 读 Windows 系统代理(注册表)。clash/v2ray 的"系统代理"模式设在这里, 但不一定有 HTTP_PROXY env。
  // 非 Windows 或未开启则返回空串。
  windowsSystemProxy() {
    if (process.platform !== "win32") return "";
    try {
      const base = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
      const enabled = spawnSync("reg", ["query", base, "/v", "ProxyEnable"], {
        encoding: "utf-8",
        windowsHide: true,
      });
      if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(enabled.stdout || "")) return "";
      const server = spawnSync("reg", ["query", base, "/v", "ProxyServer"], {
        encoding: "utf-8",
        windowsHide: true,
      });
      const m = (server.stdout || "").match(/ProxyServer\s+REG_SZ\s+(.+)/i);
      if (!m) return "";
      let val = m[1].trim();
      // 可能是 "host:port" 或 "http=host:port;https=host:port;socks=host:port"
      if (val.includes("=")) {
        const parts = val.split(";").map((s) => s.trim());
        const pick = parts.find((s) => /^https=/i.test(s)) || parts.find((s) => /^http=/i.test(s));
        val = pick ? pick.split("=")[1] : "";
      }
      return val ? `http://${val.trim()}` : "";
    } catch (_e) {
      return "";
    }
  }

  // 给"更新检查/下载"挑一个代理 agent: 优先本机 sing-box SOCKS(代理运行中, 已把 github 加入路由),
  // 否则用系统代理 env(HTTPS_PROXY 等); 都没有则 null(直连)。国内直连 GitHub CDN 常失败, 故走代理。
  updateProxyAgent() {
    try {
      const { SocksProxyAgent } = require("socks-proxy-agent");
      if (this.getProxyState().running && this.getProxyState().port) {
        return new SocksProxyAgent(`socks5h://127.0.0.1:${this.getProxyState().port}`);
      }
      // sing-box 未开时也能更新: 兜底走 环境代理(env) -> Windows 系统代理(注册表)。
      const proxyUrl =
        process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy ||
        process.env.ALL_PROXY ||
        process.env.all_proxy ||
        this.windowsSystemProxy();
      if (proxyUrl) {
        if (/^socks/i.test(proxyUrl)) {
          return new SocksProxyAgent(proxyUrl);
        }
        const { HttpsProxyAgent } = require("https-proxy-agent");
        return new HttpsProxyAgent(proxyUrl);
      }
    } catch (_err) {
      /* 构造失败则直连 */
    }
    return null;
  }

  fetchText(url, redirectsLeft = 5, agent) {
    if (agent === undefined) {
      agent = (this.updateProxyAgent && this.updateProxyAgent()) || null;
    }
    return new Promise((resolve) => {
      try {
        const protocol = new URL(url).protocol === "http:" ? http : https;
        const req = protocol.get(
          url,
          {
            headers: { "User-Agent": "ShareGPT-Updater" },
            timeout: 8000,
            agent: agent || undefined,
          },
          (res) => {
            const status = Number(res.statusCode || 0);
            if (
              [301, 302, 303, 307, 308].includes(status) &&
              res.headers.location &&
              redirectsLeft > 0
            ) {
              res.resume();
              this.fetchText(
                new URL(res.headers.location, url).toString(),
                redirectsLeft - 1,
                agent,
              ).then(resolve);
              return;
            }
            if (status < 200 || status >= 300) {
              res.resume();
              resolve(null);
              return;
            }
            let data = "";
            res.setEncoding("utf-8");
            res.on("data", (chunk) => {
              data += chunk;
            });
            res.on("end", () => resolve(data));
          },
        );
        req.on("error", () => resolve(null));
        req.on("timeout", () => {
          req.destroy();
          resolve(null);
        });
      } catch (_err) {
        resolve(null);
      }
    });
  }

  // GitHub /releases/latest 的最终重定向目标才是发布版本真源。
  resolveRedirectUrl(url, redirectsLeft = 5, agent) {
    if (agent === undefined) {
      agent = (this.updateProxyAgent && this.updateProxyAgent()) || null;
    }
    return new Promise((resolve) => {
      try {
        const protocol = new URL(url).protocol === "http:" ? http : https;
        const req = protocol.get(
          url,
          {
            headers: { "User-Agent": "ShareGPT-Updater" },
            timeout: 8000,
            agent: agent || undefined,
          },
          (res) => {
            const status = Number(res.statusCode || 0);
            if (
              [301, 302, 303, 307, 308].includes(status) &&
              res.headers.location &&
              redirectsLeft > 0
            ) {
              res.resume();
              this.resolveRedirectUrl(
                new URL(res.headers.location, url).toString(),
                redirectsLeft - 1,
                agent,
              ).then(resolve);
              return;
            }
            res.resume();
            resolve(status >= 200 && status < 300 ? url : null);
          },
        );
        req.on("error", () => resolve(null));
        req.on("timeout", () => {
          req.destroy();
          resolve(null);
        });
      } catch (_err) {
        resolve(null);
      }
    });
  }

  // latest.yml 仅在内容与 tag 一致时辅助解析 Windows 文件名；它不能改写 UI 版本。
  async checkLatestRelease() {
    if (!this.repo) return null;
    const agent = (this.updateProxyAgent && this.updateProxyAgent()) || null;
    const latestUrl = await this.resolveRedirectUrl(
      `https://github.com/${this.repo}/releases/latest`,
      5,
      agent,
    );
    if (!latestUrl) return null;
    const ymlText =
      (await this.fetchText(
        `https://github.com/${this.repo}/releases/latest/download/latest.yml`,
        5,
        agent,
      )) || "";
    return buildUpdateReleaseInfo({
      repo: this.repo,
      latestUrl,
      ymlText,
      platform: process.platform,
      arch: process.arch,
    });
  }

  async downloadUpdatePackage(payload = {}, onProgress = null, redirectsLeft = 5, target = null) {
    fs.mkdirSync(this.updatesDir, { recursive: true });
    const resolvedTarget =
      target || this.resolveUpdateDownloadTarget(payload?.url, payload?.fileName, payload?.version);
    const url = new URL(String(payload?.url || ""));
    if (url.protocol !== "https:") throw new Error("更新下载重定向必须保持 HTTPS");
    const { filePath } = resolvedTarget;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const protocol = url.protocol === "https:" ? https : http;
    const emitProgress = typeof onProgress === "function" ? onProgress : () => {};

    return new Promise((resolve, reject) => {
      const request = protocol.get(url, (response) => {
        const status = Number(response.statusCode || 0);

        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.resume();
          if (redirectsLeft <= 0) {
            reject(new Error("更新下载重定向次数过多"));
            return;
          }
          const redirectedUrl = new URL(response.headers.location, url);
          if (redirectedUrl.protocol !== "https:") {
            reject(new Error("更新下载重定向必须保持 HTTPS"));
            return;
          }
          this.downloadUpdatePackage(
            {
              ...payload,
              url: redirectedUrl.toString(),
            },
            onProgress,
            redirectsLeft - 1,
            resolvedTarget,
          ).then(resolve, reject);
          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`下载更新失败（${status}）`));
          return;
        }

        const tempPath = `${filePath}.download`;
        const output = fs.createWriteStream(tempPath);
        const total = Number.parseInt(String(response.headers["content-length"] || "0"), 10) || 0;
        let transferred = 0;
        emitProgress({
          phase: "download",
          fileName: path.basename(filePath),
          transferred,
          total,
          percent: 0,
        });

        output.on("error", (err) => {
          response.destroy();
          try {
            fs.unlinkSync(tempPath);
          } catch {}
          reject(err);
        });

        response.on("error", (err) => {
          output.destroy(err);
        });

        response.on("data", (chunk) => {
          transferred += chunk.length;
          emitProgress({
            phase: "download",
            fileName: path.basename(filePath),
            transferred,
            total,
            percent: total ? Math.min(100, Math.round((transferred / total) * 100)) : 0,
          });
        });

        output.on("finish", () => {
          output.close(() => {
            try {
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
              }
              fs.renameSync(tempPath, filePath);
              emitProgress({
                phase: "download",
                fileName: path.basename(filePath),
                transferred,
                total: total || transferred,
                percent: 100,
                done: true,
              });
              resolve({
                filePath,
                fileName: path.basename(filePath),
                size: fs.statSync(filePath).size,
              });
            } catch (err) {
              try {
                fs.unlinkSync(tempPath);
              } catch {}
              reject(err);
            }
          });
        });

        response.pipe(output);
      });

      request.on("error", reject);
      request.setTimeout(120000, () => {
        request.destroy(new Error("下载更新超时"));
      });
    });
  }
}

module.exports = { UpdateService };
