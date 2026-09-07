const { once } = require("node:events");

// Vite's listen(0) can fall back to its default port. Let the OS allocate the
// fixture's loopback port directly, including on Windows with reserved ranges.
async function listenFixture(server) {
  if (!server.httpServer) throw new Error("Fixture requires an HTTP server");
  const listening = once(server.httpServer, "listening");
  server.httpServer.listen(0, "127.0.0.1");
  await listening;
}

module.exports = { listenFixture };
