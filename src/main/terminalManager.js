const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { readLocalJson, writeLocalJson } = require("./localJsonStore");

const MAX_SESSIONS = 8;
const MAX_BUFFER = 512 * 1024;
const LEASE_MS = 30000;
const same = (a, b) => a?.principalId === b?.principalId && a?.generation === b?.generation;
const quote = (value) => `'${value.replace(/'/g, "'\\''")}'`;

/** @returns {{ shell: string, args: string[], env: Record<string, string> }} */
function shellLaunch(command = "", platform = process.platform, environment = process.env) {
  const shell =
    platform === "win32"
      ? "powershell.exe"
      : environment.SHELL || os.userInfo().shell || "/bin/zsh";
  if (platform !== "win32" && (!path.isAbsolute(shell) || !fs.statSync(shell).isFile()))
    throw new Error("本机默认 shell 不可用，请检查系统 shell 设置");
  const env = Object.fromEntries(
    Object.entries(environment).filter(([, value]) => typeof value === "string"),
  );
  // Electron's process controls must not turn user-launched Electron programs into Node.
  for (const key of Object.keys(env))
    if (key.startsWith("SHAREGPT_") || key.startsWith("ELECTRON_") || key === "NODE_OPTIONS")
      delete env[key];
  return {
    shell,
    args:
      platform === "win32"
        ? command
          ? ["-NoLogo", "-NoExit", "-Command", command]
          : ["-NoLogo"]
        : command
          ? ["-ilc", `${command}\nexec ${quote(shell)} -i`]
          : ["-il"],
    env: { ...env, TERM: "xterm-256color" },
  };
}

// node-pty 1.1.0 leaves ConPTY's worker/input socket alive after a natural exit.
// Keep this pinned-version adapter at the process owner; never kill an exited PID.
// https://github.com/microsoft/node-pty/issues/887
function trackTerminalExit(pty, platform = process.platform) {
  if (platform === "win32") {
    const subscription = pty.onExit(() => {
      subscription.dispose();
      pty._agent?.inSocket?.destroy();
      pty._agent?._conoutSocketWorker?.dispose();
    });
  }
  return pty;
}

function spawnTerminal(file, args, options) {
  return trackTerminalExit(require("node-pty").spawn(file, args, options));
}

/** @param {{
 * context: () => any, directory: (id: string) => string,
 * fetchProfile: (server: string, token: string) => Promise<any>, emit: (event: any) => void,
 * spawn?: (file: string, args: string[], options: any) => Pick<import("node-pty").IPty, "onData" | "onExit" | "write" | "resize" | "pause" | "resume" | "kill">,
 * now?: () => number, launch?: typeof shellLaunch
 * }} options */
function createTerminalManager({
  context,
  directory,
  fetchProfile,
  emit,
  spawn = spawnTerminal,
  now = Date.now,
  launch = shellLaunch,
}) {
  const sessions = new Map();
  let grant = null;
  let epoch = 0;
  let authorizationRequest = 0;
  let poll = null;
  let checking = false;
  const notify = (type, payload = {}) =>
    emit({ type, ...payload, principalId: grant?.principalId, generation: grant?.generation });
  function close(id) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    if (!sessions.size && poll) {
      clearInterval(poll);
      poll = null;
    }
    session.data.dispose();
    session.exit.dispose();
    if (!session.ended) {
      try {
        session.pty.kill();
      } catch {
        /* The OS may have already reaped the process. */
      }
    }
  }
  function reset(reason = "") {
    epoch++;
    if (poll) clearInterval(poll);
    poll = null;
    for (const id of sessions.keys()) close(id);
    if (reason) notify("unavailable", { message: reason });
    grant = null;
  }
  function assertOwner(snapshot) {
    if (!snapshot || !same(context(), snapshot) || snapshot.principalId === "local-device")
      throw new Error("终端账号已变化，请重新打开终端");
  }
  function assertGrant(snapshot) {
    assertOwner(snapshot);
    if (!same(grant, snapshot) || now() >= grant.expiresAt)
      throw new Error("终端高级权限尚未验证或已过期，请重新验证");
  }
  async function authorize(snapshot, token) {
    assertOwner(snapshot);
    if (typeof token !== "string" || !token || token.length > 8192)
      throw new Error("请先登录获准使用高级功能的账号");
    const capturedEpoch = epoch;
    const request = ++authorizationRequest;
    const principal = context();
    let profile;
    try {
      profile = await fetchProfile(principal.serverUrl, token);
    } catch (error) {
      if (capturedEpoch === epoch && request === authorizationRequest && same(context(), snapshot))
        reset("无法核验终端使用权限，会话已结束。请检查协作连接后重试。");
      throw error;
    }
    assertOwner(snapshot);
    if (capturedEpoch !== epoch || request !== authorizationRequest)
      throw new Error("终端权限请求已过期，请重试");
    if (
      profile?.username !== principal.username ||
      !(profile.isAdmin || profile.advancedAiAllowed)
    ) {
      reset("当前账号尚未获准使用高级功能，终端会话已结束。");
      throw new Error("终端属于高级功能，请联系管理员批准后使用");
    }
    grant = { ...snapshot, token, expiresAt: now() + LEASE_MS };
    return true;
  }
  function startPolling() {
    if (poll) return;
    poll = setInterval(async () => {
      if (checking || !grant) return;
      checking = true;
      const captured = grant;
      try {
        await authorize(captured, captured.token);
      } catch {
        /* authorization reports and revokes its own generation */
      } finally {
        checking = false;
      }
    }, 10000);
    poll.unref?.();
  }
  const describe = (s) => ({ id: s.id, title: s.title, ended: s.ended, exitCode: s.exitCode });
  function get(snapshot, id) {
    assertGrant(snapshot);
    const s = sessions.get(id);
    if (!s) throw new Error("终端会话已关闭");
    return s;
  }
  function settingsFile(snapshot) {
    const file = path.join(directory(snapshot.principalId), "terminal.json");
    for (const target of [file, `${file}.bak`]) {
      try {
        if (fs.lstatSync(target).isSymbolicLink())
          throw new Error("终端设置不能指向资料目录外的链接");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    return file;
  }
  const validSettings = (v) =>
    v &&
    typeof v.startupCommand === "string" &&
    v.startupCommand.length <= 8192 &&
    !v.startupCommand.includes("\0");
  return {
    reset,
    async handle(action, payload, snapshot) {
      assertOwner(snapshot);
      if (action === "close-all") {
        reset();
        return true;
      }
      if (action === "authorize") {
        await authorize(snapshot, payload?.token);
        return {
          settings: readLocalJson(settingsFile(snapshot), { startupCommand: "" }, validSettings),
          sessions: [...sessions.values()].map(describe),
        };
      }
      if (action !== "create") assertGrant(snapshot);
      if (action === "settings") {
        if (!validSettings(payload)) throw new Error("启动指令不合法或超过 8192 字符");
        return writeLocalJson(
          settingsFile(snapshot),
          { startupCommand: payload.startupCommand },
          validSettings,
        );
      }
      if (action === "create") {
        await authorize(snapshot, grant?.token);
        if (sessions.size >= MAX_SESSIONS)
          throw new Error("最多同时保留 8 个终端，请先关闭不需要的会话");
        const settings = readLocalJson(
          settingsFile(snapshot),
          { startupCommand: "" },
          validSettings,
        );
        const config = launch(settings.startupCommand);
        const pty = spawn(config.shell, config.args, {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd: os.homedir(),
          env: config.env,
        });
        const s = {
          id: randomUUID(),
          title: path.basename(config.shell),
          pty,
          buffer: "",
          sequence: 0,
          attached: false,
          pending: 0,
          ended: false,
          exitCode: null,
          data: null,
          exit: null,
        };
        sessions.set(s.id, s);
        s.data = pty.onData((data) => {
          if (!sessions.has(s.id) || !same(context(), snapshot)) return;
          if (!grant || now() >= grant.expiresAt) {
            reset("终端权限已过期，会话已结束。请重新验证。");
            return;
          }
          s.buffer = (s.buffer + data).slice(-MAX_BUFFER);
          s.sequence++;
          if (s.attached) {
            s.pending += data.length;
            if (s.pending > 65536) pty.pause();
            notify("data", { id: s.id, data, sequence: s.sequence });
          } else if (s.buffer.length >= MAX_BUFFER) pty.pause();
        });
        s.exit = pty.onExit(({ exitCode }) => {
          if (!sessions.has(s.id)) return;
          s.ended = true;
          s.exitCode = exitCode;
          notify("exit", describe(s));
        });
        startPolling();
        return describe(s);
      }
      const s = get(snapshot, payload?.id);
      if (action === "attach") {
        s.attached = true;
        s.pending = 0;
        if (!s.ended) s.pty.resume();
        return { ...describe(s), buffer: s.buffer, sequence: s.sequence };
      }
      if (action === "close") {
        close(s.id);
        return true;
      }
      if (action === "ack") {
        const count = Number(payload.count);
        if (!Number.isSafeInteger(count) || count < 0 || count > MAX_BUFFER * 2)
          throw new Error("终端流量确认无效");
        s.pending = Math.max(0, s.pending - count);
        if (!s.ended && s.pending < 32768) s.pty.resume();
        return true;
      }
      if (s.ended) throw new Error("终端已退出，请新建会话");
      if (action === "write") {
        if (typeof payload.data !== "string" || payload.data.length > 65536)
          throw new Error("一次终端输入不能超过 64 KB");
        s.pty.write(payload.data);
        return true;
      }
      if (action === "resize") {
        const { cols, rows } = payload;
        if (![cols, rows].every((v) => Number.isInteger(v) && v >= 2 && v <= 1000))
          throw new Error("终端尺寸无效");
        s.pty.resize(cols, rows);
        return true;
      }
      throw new Error("不支持的终端操作");
    },
  };
}

module.exports = { createTerminalManager, shellLaunch, spawnTerminal, trackTerminalExit };
