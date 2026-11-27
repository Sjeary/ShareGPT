const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const http = require("node:http");
const {
  detectLocalProxies,
  isSocks5Handshake,
  isHttpProxyResponse,
} = require("../localProxyDetect");

async function listen(t, server) {
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      }),
  );
  return { port: server.address().port, http: true, label: "test proxy" };
}

test("SOCKS5 greeting validates version, method and exact response length", () => {
  for (const method of [0, 2]) assert.equal(isSocks5Handshake(Buffer.from([5, method])), true);
  for (const reply of [[4, 0], [5, 255], [5], [5, 0, 0]]) {
    assert.equal(isSocks5Handshake(Buffer.from(reply)), false);
  }
  assert.equal(isHttpProxyResponse(Buffer.from("HTTP/1.1 400 Bad Request\r\n\r\n")), false);
});

test("mixed and authenticated SOCKS ports use a real fragmented handshake, preferring SOCKS", async (t) => {
  for (const method of [0, 2]) {
    const candidate = await listen(
      t,
      net.createServer((socket) =>
        socket.once("data", (bytes) => {
          assert.deepEqual([...bytes], [5, 1, 0]);
          socket.write(Buffer.from([5]));
          setTimeout(() => socket.end(Buffer.from([method])), 5);
        }),
      ),
    );
    assert.deepEqual(await detectLocalProxies([candidate]), [
      { host: "127.0.0.1", port: candidate.port, label: candidate.label, protocol: "socks5" },
    ]);
  }
});

test("HTTP detection uses only an invalid loopback CONNECT and requires proxy evidence", async (t) => {
  const server = http.createServer((_req, res) => res.end("ordinary page"));
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("connect", (req, socket) => {
    assert.equal(req.url, "127.0.0.1:0");
    socket.end(
      "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=local\r\nContent-Length: 0\r\n\r\n",
    );
  });
  const candidate = await listen(t, server);
  assert.equal((await detectLocalProxies([candidate]))[0].protocol, "http");
});

test("ordinary web servers, TCP listeners, malformed SOCKS and trickling sockets are excluded", async (t) => {
  const web = http.createServer((_req, res) => res.end("ordinary page"));
  web.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
  const candidates = [await listen(t, web)];
  for (const handler of [
    () => {},
    (socket) => socket.once("data", () => socket.end(Buffer.from([4, 0]))),
    (socket) => {
      const timer = setInterval(() => socket.write("x"), 10);
      socket.on("close", () => clearInterval(timer));
    },
  ]) {
    candidates.push(await listen(t, net.createServer(handler)));
  }
  const start = Date.now();
  assert.deepEqual(await detectLocalProxies(candidates, { timeoutMs: 80 }), []);
  assert.ok(Date.now() - start < 1500, "absolute probe deadlines are bounded");
});
