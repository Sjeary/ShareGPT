const net = require("node:net");

const LOCAL_PROXY_CANDIDATES = [
  { port: 7897, http: true, label: "Clash Verge / Mihomo (7897)" },
  { port: 7890, http: true, label: "Clash (7890)" },
  { port: 10808, label: "v2rayN SOCKS5 (10808)" },
  { port: 10809, http: true, label: "v2rayN HTTP (10809)" },
  { port: 1080, label: "本地 SOCKS5 (1080)" },
  { port: 20171, label: "v2rayA SOCKS5 (20171)" },
  { port: 20170, http: true, label: "v2rayA HTTP (20170)" },
  { port: 7891, label: "Clash SOCKS5 (7891)" },
  { port: 8080, http: true, label: "本地 HTTP 代理 (8080)" },
];

function isSocks5Handshake(buffer) {
  return buffer.length === 2 && buffer[0] === 5 && (buffer[1] === 0 || buffer[1] === 2);
}

function isHttpProxyResponse(buffer) {
  const text = buffer.toString("latin1");
  const end = text.indexOf("\r\n\r\n");
  if (end < 0) return false;
  const headers = text.slice(0, end);
  const status = /^HTTP\/1\.[01] (\d{3})(?: [^\r\n]*)?\r\n/.exec(`${headers}\r\n`);
  if (!status || ![400, 403, 405, 407, 502, 503, 504].includes(Number(status[1]))) return false;
  // Generic Web servers also reject CONNECT. Require proxy-specific evidence,
  // rather than interpreting any HTTP error as a working HTTP proxy.
  return (
    /^Proxy-(?:Authenticate|Agent):\s*\S/im.test(headers) ||
    /^Via:\s*\S/im.test(headers) ||
    /\b(?:proxy|tunnel)\b/i.test(text.slice(end + 4))
  );
}

function probeProtocol(port, protocol, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let data = Buffer.alloc(0);
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (valid) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      socket.destroy();
      resolve(valid);
    };
    // An absolute deadline prevents a trickling local service extending the probe.
    const deadline = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", () =>
      socket.write(
        protocol === "socks5"
          ? Buffer.from([5, 1, 0])
          : "CONNECT 127.0.0.1:0 HTTP/1.1\r\nHost: 127.0.0.1:0\r\nConnection: close\r\n\r\n",
      ),
    );
    socket.on("data", (chunk) => {
      data = Buffer.concat([data, chunk]);
      if (data.length > 8192) return finish(false);
      if (protocol === "socks5") {
        if (data.length >= 2) finish(isSocks5Handshake(data));
      } else if (isHttpProxyResponse(data)) finish(true);
    });
    socket.once("error", () => finish(false));
    socket.once("end", () => finish(protocol === "http" && isHttpProxyResponse(data)));
    socket.once("close", () => finish(false));
  });
}

async function detectLocalProxies(candidates = LOCAL_PROXY_CANDIDATES, { timeoutMs = 300 } = {}) {
  const results = await Promise.all(
    candidates.map(async (candidate) => {
      if (!Number.isInteger(candidate.port) || candidate.port < 1 || candidate.port > 65535)
        return null;
      const deadline = Math.max(1, Math.min(300, timeoutMs));
      const protocol = (await probeProtocol(candidate.port, "socks5", deadline))
        ? "socks5"
        : candidate.http && (await probeProtocol(candidate.port, "http", deadline))
          ? "http"
          : null;
      return protocol
        ? { host: "127.0.0.1", port: candidate.port, protocol, label: candidate.label }
        : null;
    }),
  );
  return results.filter(Boolean);
}

module.exports = { detectLocalProxies, isSocks5Handshake, isHttpProxyResponse };
