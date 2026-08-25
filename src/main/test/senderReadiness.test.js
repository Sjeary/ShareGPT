const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");

const { waitForLoopbackPortsListening } = require("../backend");

test("sender readiness waits until every loopback port is listening", async (t) => {
  const servers = [net.createServer(), net.createServer()];
  t.after(() => {
    for (const server of servers) server.close();
  });

  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) =>
          server.listen({ host: "127.0.0.1", port: 0 }, () => resolve(undefined)),
        ),
    ),
  );
  const ports = servers.map((server) => {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    return address.port;
  });

  await waitForLoopbackPortsListening(ports, null, 1000);
});

test("sender readiness rejects when the child exits before listening", async () => {
  await assert.rejects(
    waitForLoopbackPortsListening([65534], { exitCode: 1, signalCode: null }, 1000),
    /就绪前退出/,
  );
});
