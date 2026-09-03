const http = require("node:http");

function json(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function startCollabLoginFixture() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/api/login") {
      const body = JSON.parse((await readBody(request)) || "{}");
      const username = String(body.username || "layout-verifier");
      json(response, 200, {
        token: "layout-fixture-token",
        username,
        profile: { displayName: username },
        history: [],
        users: [],
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/client/bootstrap") {
      json(response, 200, {
        sender: {},
        update: {},
        proxyRoutes: [],
        capabilities: { proxyRoutes: { available: true, authoritative: true } },
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/logout") {
      json(response, 200, { ok: true });
      return;
    }
    json(response, 404, { error: "not found" });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function loginThroughForm(page, baseUrl) {
  const startSetup = page.getByRole("button", { name: "开始设置", exact: true });
  if ((await page.locator("#account-server").count()) === 0) {
    await Promise.race([
      startSetup.waitFor({ state: "visible", timeout: 8000 }),
      page.locator("#account-server").waitFor({ state: "visible", timeout: 8000 }),
    ]).catch(() => undefined);
  }
  if (await startSetup.isVisible().catch(() => false)) await startSetup.click();
  const chooseTeam = page.getByRole("button", { name: /连接团队/ });
  if ((await page.locator("#account-server").count()) === 0) {
    await chooseTeam.waitFor({ state: "visible", timeout: 8000 });
    await chooseTeam.click();
  }
  await page.locator("#account-server").waitFor({ state: "visible" });
  await page.locator("#account-server").fill(baseUrl);
  await page.locator("#account-username").fill("layout-verifier");
  await page.locator("#account-password").fill("fixture-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator('[data-tour="nav-account"]').waitFor({ state: "visible" });
  const skipTour = page.getByRole("button", { name: "跳过", exact: true });
  if (await skipTour.isVisible().catch(() => false)) await skipTour.click();
  const closeGuide = page.getByRole("button", { name: "关闭引导", exact: true });
  if (await closeGuide.isVisible().catch(() => false)) await closeGuide.click();
}

module.exports = { loginThroughForm, startCollabLoginFixture };
