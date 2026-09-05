function buildAiRouteHealth(route, detected) {
  const expected = route.expected && typeof route.expected === "object" ? route.expected : {};
  const text = (value) => String(value || "").trim();
  const expectedIp = text(expected.ip).toLowerCase();
  const expectedCountry = text(expected.countryCode).toUpperCase();
  const expectedAsn = text(expected.asn).toUpperCase().replace(/^AS/, "");
  const actualAsn = text(detected.asn).toUpperCase().replace(/^AS/, "");
  const checks = {
    httpCrossCheck: Boolean(detected.ip),
    expectedIp: !expectedIp || text(detected.ip).toLowerCase() === expectedIp,
    expectedCountry:
      !expectedCountry || text(detected.countryCode).toUpperCase() === expectedCountry,
    expectedAsn: !expectedAsn || actualAsn === expectedAsn,
    dnsRouteTagsPresent: Boolean(route.dnsTag && route.outboundTag),
    detectedIpv4: Boolean(detected.ip && !String(detected.ip).includes(":")),
  };
  return {
    ...detected,
    ok: Object.values(checks).every(Boolean),
    routeId: route.id,
    route: route.label,
    expected,
    checks,
  };
}

module.exports = { buildAiRouteHealth };
