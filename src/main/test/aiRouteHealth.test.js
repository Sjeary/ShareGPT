const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildAiRouteHealth } = require("../aiRouteHealth");

const route = { id: "test", label: "Test", dnsTag: "dns", outboundTag: "out" };
const detected = { ip: "203.0.113.1", countryCode: "US", asn: "AS123" };

test("route preflight reports observations without claiming session leak verification", () => {
  const health = buildAiRouteHealth(route, detected);
  assert.equal(health.ok, true);
  assert.equal(health.checks.dnsRouteTagsPresent, true);
  assert.equal(health.checks.detectedIpv4, true);
  for (const name of ["dnsSameRoute", "ipv6Contained", "webRtcProtected"]) {
    assert.equal(Object.hasOwn(health.checks, name), false);
  }
});

test("existing route admission conditions still fail closed", () => {
  assert.equal(buildAiRouteHealth({ ...route, dnsTag: "" }, detected).ok, false);
  assert.equal(buildAiRouteHealth({ ...route, outboundTag: "" }, detected).ok, false);
  assert.equal(buildAiRouteHealth(route, { ...detected, ip: "" }).ok, false);
  assert.equal(buildAiRouteHealth(route, { ...detected, ip: "2001:db8::1" }).ok, false);
  for (const expected of [{ ip: "203.0.113.2" }, { countryCode: "GB" }, { asn: "456" }]) {
    assert.equal(buildAiRouteHealth({ ...route, expected }, detected).ok, false);
  }
  assert.equal(
    buildAiRouteHealth({ ...route, expected: { ...detected, asn: "123" } }, detected).ok,
    true,
  );
});
