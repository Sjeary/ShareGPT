const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyIpAddress,
  endpointRequestOptions,
  parseEndpoint,
  resolveEndpoint,
} = require("../endpointSecurity");

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
