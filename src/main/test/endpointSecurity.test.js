const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyIpAddress,
  endpointRequestOptions,
  parseEndpoint,
  resolveEndpoint,
} = require("../endpointSecurity");
const {
  isBlockedAddress,
  resolvePublicEndpoint,
} = require("../../../collab_server2/translation_profiles");

test("desktop and server reject private, translated, reserved and invalid DNS addresses", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "64:ff9b::7f00:1",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b::a00:1",
    "0:0:0:0:0:ffff:7f00:1",
    "2002:0a00:0001::1",
    "198.51.100.8",
    "::",
    "invalid",
  ]) {
    assert.notEqual(classifyIpAddress(address), "public", address);
    assert.equal(isBlockedAddress(address), true, address);
    const lookup = async () => [{ address, family: address.includes(":") ? 6 : 4 }];
    await assert.rejects(resolveEndpoint(new URL("https://fixture.invalid"), { lookup }));
    await assert.rejects(resolvePublicEndpoint(new URL("https://fixture.invalid"), lookup));
  }
});

test("both resolvers pin public DNS and reject mixed or incorrectly typed answers", async () => {
  const url = new URL("https://fixture.invalid");
  for (const record of [
    { address: "1.1.1.1", family: 4 },
    { address: "2001:4860:4860::8888", family: 6 },
  ]) {
    const lookup = async () => [record];
    assert.deepEqual(await resolveEndpoint(url, { lookup }), record);
    assert.deepEqual(await resolvePublicEndpoint(url, lookup), record);
  }
  for (const records of [
    [
      { address: "1.1.1.1", family: 4 },
      { address: "64:ff9b::a00:1", family: 6 },
    ],
    [{ address: "1.1.1.1", family: 6 }],
  ])
    await assert.rejects(resolvePublicEndpoint(url, async () => records));
});

test("desktop explicit offline loopback remains allowed while server upstreams stay public-only", async () => {
  const url = new URL("http://127.0.0.1:5000");
  assert.deepEqual(await resolveEndpoint(url), { address: "127.0.0.1", family: 4 });
  await assert.rejects(resolvePublicEndpoint(url), /禁止访问/);
});

test("remote HTTP is opt-in while credentials, fragments, and non-HTTP schemes stay blocked", () => {
  assert.throws(() => parseEndpoint("http://api.example"), /必须使用 HTTPS/);
  assert.equal(parseEndpoint("http://api.example/v1", { allowRemoteHttp: true }).protocol, "http:");
  assert.throws(
    () => parseEndpoint("https://user:secret@api.example/v1", { allowRemoteHttp: true }),
    /账号凭据/,
  );
  assert.throws(
    () => parseEndpoint("https://api.example/v1#secret", { allowRemoteHttp: true }),
    /片段标识/,
  );
  assert.throws(() => parseEndpoint("file:///tmp/service"), /HTTP 或 HTTPS/);
});

test("IPv4 metadata, private, link-local, and shared ranges never classify as public", () => {
  assert.equal(classifyIpAddress("93.184.216.34"), "public");
  assert.equal(classifyIpAddress("10.0.0.1"), "private");
  assert.equal(classifyIpAddress("169.254.169.254"), "link-local");
  assert.equal(classifyIpAddress("100.100.100.200"), "metadata");
  assert.equal(classifyIpAddress("168.63.129.16"), "metadata");
  assert.equal(classifyIpAddress("100.64.0.1"), "shared");
});

test("IPv6 wrappers cannot hide loopback, private, or metadata IPv4 addresses", () => {
  assert.equal(classifyIpAddress("::1"), "loopback");
  assert.equal(classifyIpAddress("fc00::1"), "private");
  assert.equal(classifyIpAddress("fe80::1"), "link-local");
  assert.equal(classifyIpAddress("::ffff:169.254.169.254"), "link-local");
  assert.equal(classifyIpAddress("64:ff9b::a9fe:a9fe"), "link-local");
});

test("DNS validation rejects mixed answers and family mismatches", async () => {
  const endpoint = parseEndpoint("https://api.example/v1");
  await assert.rejects(
    resolveEndpoint(endpoint, {
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
    }),
    /禁止访问/,
  );
  await assert.rejects(
    resolveEndpoint(endpoint, {
      lookup: async () => [{ address: "93.184.216.34", family: 6 }],
    }),
    /无效的 DNS/,
  );
});

test("validated DNS is pinned while HTTPS keeps the original hostname for SNI", async () => {
  const endpoint = parseEndpoint("https://api.example/v1");
  const record = await resolveEndpoint(endpoint, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  const options = endpointRequestOptions(endpoint, record);
  assert.equal(options.hostname, "api.example");
  assert.equal(options.servername, "api.example");
  await new Promise((resolve, reject) => {
    options.lookup("api.example", {}, (error, address, family) => {
      if (error) reject(error);
      else {
        assert.equal(address, "93.184.216.34");
        assert.equal(family, 4);
        resolve();
      }
    });
  });
});
