const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "admin_console", "ui", "dist");

const users = [
  {
    username: "admin",
    displayName: "Administrator",
    isAdmin: true,
    advancedAiAllowed: true,
    allowedProxyRouteIds: [],
    disabled: false,
    online: true,
    client: { version: "1.0.10", platform: "win32" },
  },
  {
    username: "member",
    displayName: "Member",
    isAdmin: false,
    advancedAiAllowed: true,
    allowedProxyRouteIds: ["route-us"],
    disabled: false,
    online: false,
    client: { version: "1.0.9", platform: "darwin" },
  },
];

const bootstrap = {
  sender: {
    proxy_server: "proxy.example.com",
    proxy_port: "443",
    proxy_uuid: "fixture-uuid",
    socks_listen_port: "1080",
    fallback_mode: "system_proxy",
    fallback_local_port: "7890",
    target_domains: "chatgpt.com,claude.ai",
  },
  update: { version: "1.0.10", publishedAt: "", windows: {}, macos: {} },
  aiRouting: {
    version: 1,
    defaultRouteByKind: {
      gpt: "route-us",
      claude: "internal-unified",
      gemini: "",
    },
    updatedAt: "2026-09-07T00:00:00.000Z",
  },
  extra: {},
};

const routes = [
  {
    id: "route-us",
    name: "美国出口",
    enabled: true,
    outbound: { type: "socks", server: "route.example.com", server_port: 1080 },
    expected: { ip: "203.0.113.7", countryCode: "US", asn: "AS64500" },
  },
];

const invites = [
  {
    id: "inv-fixture-1",
    code: "FIXTUREINVITE001",
    status: "active",
    note: "新同事首批入职",
    createdBy: "admin",
    createdAt: "2026-09-07T00:00:00.000Z",
    expiresAt: null,
    maxUses: 5,
    usedCount: 1,
    remainingUses: 4,
    chatDisabled: false,
    allowedProxyRouteIds: ["route-us"],
    revokedAt: null,
    revokedBy: null,
    registrations: [
      {
        username: "member",
        displayName: "Member",
        registeredAt: "2026-09-07T01:00:00.000Z",
      },
    ],
  },
];

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
  });
  res.end(JSON.stringify(payload));
}

function createFixtureServer() {
  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;
    if (pathname.startsWith("/api/") && req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "GET,POST,PUT,PATCH,OPTIONS",
      });
      res.end();
      return;
    }
    if (pathname === "/api/admin/login" && req.method === "POST") {
      json(res, 200, {
        token: "fixture-admin-token",
        profile: { username: "admin", displayName: "Administrator", isAdmin: true },
      });
      return;
    }
    if (
      pathname.startsWith("/api/admin/") &&
      req.headers.authorization !== "Bearer fixture-admin-token"
    ) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    if (pathname === "/api/admin/users") return json(res, 200, { users });
    if (pathname === "/api/admin/invites" && req.method === "GET") {
      return json(res, 200, { invites });
    }
    if (pathname === "/api/admin/invites" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const parsed = body ? JSON.parse(body) : {};
        const created = {
          id: `inv-fixture-${invites.length + 1}`,
          code: `CREATEDCODE00${invites.length + 1}`,
          status: "active",
          note: parsed.note || "",
          createdBy: "admin",
          createdAt: "2026-09-07T02:00:00.000Z",
          expiresAt: parsed.expiresInHours ? "2026-09-14T02:00:00.000Z" : null,
          maxUses: parsed.maxUses ?? 1,
          usedCount: 0,
          remainingUses: parsed.maxUses ?? 1,
          chatDisabled: Boolean(parsed.chatDisabled),
          allowedProxyRouteIds: Array.isArray(parsed.allowedProxyRouteIds)
            ? parsed.allowedProxyRouteIds
            : [],
          revokedAt: null,
          revokedBy: null,
          registrations: [],
        };
        invites.unshift(created);
        json(res, 200, { ok: true, invite: created });
      });
      return;
    }
    const revokeMatch = pathname.match(/^\/api\/admin\/invites\/([^/]+)\/revoke$/);
    if (revokeMatch && req.method === "POST") {
      const target = invites.find((item) => item.id === revokeMatch[1]);
      if (!target) return json(res, 404, { error: "not_found" });
      target.status = "revoked";
      target.revokedAt = "2026-09-07T03:00:00.000Z";
      target.revokedBy = "admin";
      return json(res, 200, { ok: true, invite: target });
    }
    if (pathname === "/api/admin/bootstrap") return json(res, 200, bootstrap);
    if (pathname === "/api/admin/proxy-routes") {
      return json(res, 200, { version: 1, routes, updatedAt: "2026-09-07T00:00:00.000Z" });
    }
    if (pathname === "/api/admin/proxy-route-health") return json(res, 200, { reports: [] });
    if (pathname === "/api/admin/translation-profiles") {
      return json(res, 200, {
        version: 1,
        defaultProfileId: "managed-default",
        encryptionReady: true,
        profiles: [],
      });
    }
    if (pathname === "/api/admin/translation-usage") {
      return json(res, 200, {
        totals: {
          requests: 3,
          inputChars: 120,
          outputChars: 90,
          inputTokens: 40,
          outputTokens: 30,
          totalTokens: 70,
          costByCurrency: {},
        },
        byProfile: [],
        byUser: [],
        recent: [],
      });
    }
    if (pathname === "/api/admin/ai-usage") {
      const service = requestUrl.searchParams.get("service") || "gpt";
      return json(res, 200, {
        service,
        from: "",
        to: "",
        totalQueries: service === "gpt" ? 12 : 0,
        userCount: service === "gpt" ? 2 : 0,
        users:
          service === "gpt"
            ? [
                { username: "admin", displayName: "Administrator", count: 8, ratio: 2 / 3 },
                { username: "member", displayName: "Member", count: 4, ratio: 1 / 3 },
              ]
            : [],
        serverTime: "2026-09-07T00:00:00.000Z",
      });
    }
    json(res, 404, { error: "not_found" });
  });
}

async function main() {
  assert.ok(fs.existsSync(path.join(distDir, "index.html")), "请先构建管理员端 UI");
  assert.equal(
    fs.existsSync(path.join(rootDir, "admin_console", "src", "renderer", "index.html")),
    false,
    "旧管理界面不得继续成为第二套运行时实现",
  );
  const server = createFixtureServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const testUserData = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-admin-test-"));
  const electronApp = await electron.launch({
    args: [path.join(rootDir, "admin_console")],
    env: {
      ...process.env,
      SHAREGPT_ADMIN_TEST_HIDDEN: "1",
      SHAREGPT_ADMIN_TEST_USER_DATA: testUserData,
    },
  });
  try {
    const page = await electronApp.firstWindow();
    await page.getByLabel("服务地址").waitFor();
    await page
      .getByText(`v${require("../admin_console/package.json").version}`, { exact: true })
      .waitFor();
    await page.getByLabel("服务地址").fill(baseUrl);
    await page.getByLabel("管理员账号").fill("admin");
    await page.getByLabel("管理员密码").fill("password");
    await page.getByRole("button", { name: "登录管理后台" }).click();
    await page.getByRole("heading", { name: "概览" }).waitFor();

    const navLabels = (await page.locator("aside > button").allTextContents()).map((label) =>
      label.replace(/\s+/g, " ").trim(),
    );
    [
      "概览",
      "AI 使用统计",
      "AI 线路策略",
      "翻译服务",
      "成员与权限",
      "邀请链接",
      "团队统一代理",
    ].forEach((label, index) =>
      assert.ok(navLabels[index]?.startsWith(label), `第 ${index + 1} 项应为 ${label}`),
    );

    await page.getByRole("button", { name: /AI 使用统计/ }).click();
    await page.getByRole("heading", { name: "AI 使用统计" }).waitFor();
    await page.getByText("Administrator · @admin").waitFor();
    await page.getByTestId("ai-usage-成功发送").waitFor();
    assert.match(await page.getByTestId("ai-usage-成功发送").innerText(), /^12/);
    assert.equal(await page.getByText("Administrator · @admin").count(), 1);

    await page.locator("aside button").filter({ hasText: "AI 线路策略" }).click();
    await page.getByText("各 AI 默认出口", { exact: true }).waitFor();
    assert.equal(await page.getByText("各 AI 默认出口", { exact: true }).count(), 1);
    assert.deepEqual(
      await page.locator("main select").evaluateAll((items) => items.map((item) => item.value)),
      ["route-us", "internal-unified", ""],
    );

    await page.locator("aside button").filter({ hasText: "邀请链接" }).click();
    await page.getByRole("heading", { name: "邀请链接" }).waitFor();
    await page.getByText("新同事首批入职", { exact: true }).waitFor();
    await page.getByPlaceholder("例如：研发部新成员 / 临时试用").fill("前端联调测试链接");
    await page.getByRole("button", { name: "生成邀请链接" }).click();
    await page.getByText("新邀请链接已就绪", { exact: true }).waitFor();
    await page.getByText("前端联调测试链接", { exact: true }).waitFor();

    await page.locator("aside button").filter({ hasText: "团队统一代理" }).click();
    await page.getByText("连接参数", { exact: true }).waitFor();
    assert.equal(await page.getByText("各 AI 默认出口", { exact: true }).count(), 0);
    assert.equal(await page.getByText("固定走代理的域名", { exact: true }).count(), 1);

    console.log(
      "管理员端功能对齐验收通过：导航、AI 统计、默认出口、邀请链接与团队代理边界均正确。",
    );
  } finally {
    await electronApp.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(testUserData, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
