const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { UpdateService } = require("../updateService");
const { Backend } = require("../backend");

function fixture(t, routes) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-update-service-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  t.mock.method(https, "get", (url, options, callback) => {
    const respond = typeof options === "function" ? options : callback;
    const value = String(url);
    calls.push(value);
    assert.ok(routes[value], `unexpected external request: ${value}`);
    const request = Object.assign(new EventEmitter(), {
      setTimeout: () => undefined,
      destroy: (error) => {
        if (error) request.emit("error", error);
      },
    });
    process.nextTick(() => {
      const route = routes[value];
      const response = Object.assign(new PassThrough(), {
        statusCode: route.status || 200,
        headers: {
          ...(route.location ? { location: route.location } : {}),
          "content-length": String(Buffer.byteLength(route.body || "")),
        },
      });
      respond(response);
      if (route.error) response.destroy(new Error(route.error));
      else response.end(route.body || "");
    });
    return request;
  });
  const service = new UpdateService({ directory, repo: "Sjeary/ShareGPT" });
  service.updateProxyAgent = () => null;
  const backend = Object.create(Backend.prototype);
  backend.updateService = service;
  return { directory, service, backend, calls };
}

test("existing backend update facade follows GitHub Latest and ignores mismatched package metadata", async (t) => {
  const f = fixture(t, {
    "https://github.com/Sjeary/ShareGPT/releases/latest": {
      status: 302,
      location: "/Sjeary/ShareGPT/releases/tag/v1.2.3",
    },
    "https://github.com/Sjeary/ShareGPT/releases/tag/v1.2.3": {},
    "https://github.com/Sjeary/ShareGPT/releases/latest/download/latest.yml": {
      body: "version: 9.9.9\npath: unexpected.exe\n",
    },
  });
  const info = await f.backend.checkLatestRelease();
  assert.equal(info.version, "1.2.3");
  assert.match(info.url, /releases\/download\/v1\.2\.3\//);
  assert.equal(f.calls.length, 3);
});

test("existing backend download facade retains progress, HTTPS redirects and isolated final bytes", async (t) => {
  const bytes = "verified fixture bytes";
  const f = fixture(t, {
    "https://github.com/Sjeary/ShareGPT/releases/download/v1.2.3/package.dmg": {
      status: 302,
      location: "https://release-assets.githubusercontent.com/fixture.dmg",
    },
    "https://release-assets.githubusercontent.com/fixture.dmg": { body: bytes },
  });
  const progress = [];
  const result = await f.backend.downloadUpdatePackage(
    {
      url: f.calls[0] || "https://github.com/Sjeary/ShareGPT/releases/download/v1.2.3/package.dmg",
      fileName: "package.dmg",
      version: "1.2.3",
    },
    (event) => progress.push(event),
  );
  assert.equal(fs.readFileSync(result.filePath, "utf8"), bytes);
  assert.equal(result.size, Buffer.byteLength(bytes));
  assert.equal(path.dirname(result.filePath), path.join(f.directory, "v1.2.3"));
  assert.equal(fs.existsSync(result.filePath + ".download"), false);
  assert.equal(progress.at(-1).done, true);
  assert.equal(progress.at(-1).percent, 100);
});

test("downloads reject a plaintext redirect before creating a candidate file", async (t) => {
  const url = "https://github.com/Sjeary/ShareGPT/releases/download/v1.2.3/package.dmg";
  const f = fixture(t, { [url]: { status: 302, location: "http://fixture.invalid/unsafe.dmg" } });
  await assert.rejects(f.backend.downloadUpdatePackage({ url, version: "1.2.3" }), /保持 HTTPS/);
  assert.deepEqual(f.calls, [url]);
});

test("interrupted response rejects and removes its partial download", async (t) => {
  const url = "https://github.com/Sjeary/ShareGPT/releases/download/v1.2.3/package.dmg";
  const f = fixture(t, { [url]: { error: "fixture disconnect" } });
  await assert.rejects(
    f.backend.downloadUpdatePackage({ url, version: "1.2.3" }),
    /fixture disconnect/,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fs.readdirSync(path.join(f.directory, "v1.2.3")), []);
});

test("update target names stay inside the configured downloads directory", (t) => {
  const f = fixture(t, {});
  const target = f.service.resolveUpdateDownloadTarget(
    "https://github.com/a.dmg",
    "../../private.dmg",
    "../../other",
  );
  assert.ok(target.filePath.startsWith(f.directory + path.sep));
  assert.equal(path.basename(target.filePath).includes("private"), true);
});

test(
  "Windows system proxy discovery yields the event loop while the real registry command runs",
  {
    skip: process.platform !== "win32",
  },
  async () => {
    const service = new UpdateService({ directory: os.tmpdir() });
    let otherWorkRan = false;
    const otherWork = new Promise((resolve) =>
      setImmediate(() => {
        otherWorkRan = true;
        resolve();
      }),
    );
    await service.windowsSystemProxy();
    assert.equal(
      otherWorkRan,
      true,
      "main-process IPC must not wait for a synchronous registry command",
    );
    await otherWork;
  },
);

test("concurrent update checks share discovery and await asynchronous proxy resolution, then refresh again", async (t) => {
  const f = fixture(t, {
    "https://github.com/Sjeary/ShareGPT/releases/latest": {
      status: 302,
      location: "/Sjeary/ShareGPT/releases/tag/v1.2.3",
    },
    "https://github.com/Sjeary/ShareGPT/releases/tag/v1.2.3": {},
    "https://github.com/Sjeary/ShareGPT/releases/latest/download/latest.yml": {
      body: "version: 1.2.3\n",
    },
  });
  /** @type {(agent: null) => void} */
  let releaseProxy = () => {
    throw new Error("proxy discovery has not started");
  };
  let discoveries = 0;
  f.service.updateProxyAgent = () => {
    discoveries++;
    return new Promise((resolve) => {
      releaseProxy = resolve;
    });
  };
  const first = f.service.checkLatestRelease();
  const second = f.service.checkLatestRelease();
  assert.equal(discoveries, 1);
  assert.equal(f.calls.length, 0, "HTTP must wait for a resolved agent, never receive a Promise");
  releaseProxy(null);
  assert.deepEqual(await first, await second);
  assert.equal(f.calls.length, 3);
  const next = f.service.checkLatestRelease();
  assert.equal(discoveries, 2, "completed checks are not cached across explicit refreshes");
  releaseProxy(null);
  await next;
  assert.equal(f.calls.length, 6);
});

test("failed update discovery releases its flight for retry", async () => {
  const service = new UpdateService({ directory: os.tmpdir() });
  service.updateProxyAgent = async () => {
    throw new Error("proxy temporarily unavailable");
  };
  await assert.rejects(service.checkLatestRelease(), /temporarily unavailable/);
  service.updateProxyAgent = async () => null;
  service.resolveRedirectUrl = async () => null;
  assert.equal(await service.checkLatestRelease(), null);
});
