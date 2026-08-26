const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyIpAddress,
  endpointRequestOptions,
  parseEndpoint,
  resolveEndpoint,
} = require("../endpointSecurity");

test("remote endpoints require HTTPS while exact loopback endpoints may use HTTP", () => {
  assert.equal(parseEndpoint("https://api.example/v1").protocol, "https:");
  assert.equal(parseEndpoint("http://localhost:8080/v1").protocol, "http:");
  assert.equal(parseEndpoint("http://127.0.0.1:8080/v1").protocol, "http:");
  assert.equal(parseEndpoint("http://[::1]:8080/v1").protocol, "http:");
  assert.throws(() => parseEndpoint("http://api.example/v1"), /必须使用 HTTPS/);
  assert.equal(parseEndpoint("http://api.example/v1", { allowRemoteHttp: true }).protocol, "http:");
  assert.throws(() => parseEndpoint("ftp://api.example/v1"), /HTTP 或 HTTPS/);
  assert.throws(() => parseEndpoint("https://user:pass@api.example/v1"), /账号凭据/);
});

test("offline endpoints only accept the three explicit loopback hostnames", () => {
  const options = { label: "离线接口", loopbackOnly: true };
  assert.doesNotThrow(() => parseEndpoint("http://localhost:8080", options));
  assert.doesNotThrow(() => parseEndpoint("http://127.0.0.1:8080", options));
  assert.doesNotThrow(() => parseEndpoint("http://[::1]:8080", options));
  assert.throws(() => parseEndpoint("https://127.0.0.2", options), /只允许连接/);
  assert.throws(() => parseEndpoint("https://localhost.example", options), /只允许连接/);
});

test("IP classification blocks local, private, metadata and special-use ranges", () => {
  const blocked = {
    "0.0.0.0": "unspecified",
    "10.0.0.1": "private",
    "100.64.0.1": "shared",
    "100.100.100.200": "metadata",
    "127.0.0.1": "loopback",
    "168.63.129.16": "metadata",
    "169.254.169.254": "link-local",
    "172.16.0.1": "private",
    "192.168.1.1": "private",
    "224.0.0.1": "multicast",
    "::": "unspecified",
    "::1": "loopback",
    "::ffff:127.0.0.1": "loopback",
    "64:ff9b::a00:1": "private",
    "fc00::1": "private",
    "fe80::1": "link-local",
    "ff02::1": "multicast",
    "2001:db8::1": "documentation",
  };
  for (const [address, category] of Object.entries(blocked)) {
    assert.equal(classifyIpAddress(address), category, address);
  }
  assert.equal(classifyIpAddress("93.184.216.34"), "public");
  assert.equal(classifyIpAddress("2606:2800:220:1:248:1893:25c8:1946"), "public");
});

test("DNS resolution rejects any non-public answer for a remote hostname", async () => {
  const endpoint = parseEndpoint("https://api.example/v1");
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fe80::1"]) {
    await assert.rejects(
      resolveEndpoint(endpoint, {
        lookup: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
      }),
      /禁止访问/,
      address,
    );
  }
});

test("public HTTP opt-in does not weaken DNS or private literal SSRF checks", async () => {
  for (const rawUrl of ["http://10.0.0.2/v1", "https://192.168.1.2/v1"]) {
    const endpoint = parseEndpoint(rawUrl, { allowRemoteHttp: true });
    await assert.rejects(resolveEndpoint(endpoint), /禁止访问/);
  }
  const endpoint = parseEndpoint("http://api.example/v1", { allowRemoteHttp: true });
  await assert.rejects(
    resolveEndpoint(endpoint, {
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ],
    }),
    /禁止访问/,
  );
});

test("localhost must resolve exclusively to loopback addresses", async () => {
  const endpoint = parseEndpoint("http://localhost:8080");
  const record = await resolveEndpoint(endpoint, {
    lookup: async () => [
      { address: "::1", family: 6 },
      { address: "127.0.0.1", family: 4 },
    ],
  });
  assert.deepEqual(record, { address: "::1", family: 6 });
  await assert.rejects(
    resolveEndpoint(endpoint, {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    }),
    /禁止访问/,
  );
});

test("request options pin the validated address and retain the original TLS name", async () => {
  const endpoint = parseEndpoint("https://api.example:8443/v1");
  const options = endpointRequestOptions(endpoint, { address: "93.184.216.34", family: 4 });
  assert.equal(options.hostname, "api.example");
  assert.equal(options.servername, "api.example");
  assert.equal(options.port, "8443");
  const resolved = await new Promise((resolve, reject) => {
    options.lookup("api.example", {}, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(resolved, { address: "93.184.216.34", family: 4 });
});
