const dns = require("node:dns");
const net = require("node:net");
const { URL } = require("node:url");

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHostname(hostname) {
  return String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
}

function isLoopbackHostname(hostname) {
  return LOOPBACK_HOSTNAMES.has(normalizeHostname(hostname));
}

function parseEndpoint(rawUrl, { label = "接口", loopbackOnly = false } = {}) {
  const value = String(rawUrl || "").trim();
  if (!value) throw new Error(`未配置${label}地址`);

  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error(`${label}地址不合法`);
  }

  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error(`${label}地址只支持 HTTP 或 HTTPS`);
  }
  if (!endpoint.hostname || endpoint.username || endpoint.password) {
    throw new Error(`${label}地址不允许包含账号凭据`);
  }
  if (endpoint.hash) {
    throw new Error(`${label}地址不允许包含片段标识`);
  }

  const loopback = isLoopbackHostname(endpoint.hostname);
  if (loopbackOnly && !loopback) {
    throw new Error(`${label}只允许连接 localhost、127.0.0.1 或 ::1`);
  }
  if (endpoint.protocol === "http:" && !loopback) {
    throw new Error(`${label}的非回环地址必须使用 HTTPS`);
  }
  return endpoint;
}

function parseIpv4(address) {
  if (net.isIP(address) !== 4) return null;
  return address.split(".").map(Number);
}

function parseIpv6(address) {
  let value = normalizeHostname(address);
  if (net.isIP(value) !== 6 || value.includes("%")) return null;

  const lastColon = value.lastIndexOf(":");
  if (value.includes(".")) {
    const ipv4Tail = parseIpv4(value.slice(lastColon + 1));
    if (!ipv4Tail) return null;
    value = `${value.slice(0, lastColon)}:${((ipv4Tail[0] << 8) | ipv4Tail[1]).toString(16)}:${((ipv4Tail[2] << 8) | ipv4Tail[3]).toString(16)}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;

  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  const bytes = Buffer.alloc(16);
  groups.forEach((group, index) => bytes.writeUInt16BE(Number.parseInt(group, 16), index * 2));
  return bytes;
}

function classifyIpv4(address) {
  const octets = parseIpv4(address);
  if (!octets) return "invalid";
  const [a, b, c, d] = octets;
  if (a === 127) return "loopback";
  if (a === 0 && b === 0 && c === 0 && d === 0) return "unspecified";
  if (a === 0) return "reserved";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
    return "private";
  }
  if (
    (a === 100 && b === 100 && c === 100 && d === 200) ||
    (a === 168 && b === 63 && c === 129 && d === 16)
  ) {
    return "metadata";
  }
  if (a === 100 && b >= 64 && b <= 127) return "shared";
  if (a === 169 && b === 254) return "link-local";
  if (a === 192 && b === 0 && c === 0) return "reserved";
  if ((a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100)) {
    return "documentation";
  }
  if (a === 198 && (b === 18 || b === 19)) return "benchmark";
  if (a === 203 && b === 0 && c === 113) return "documentation";
  if (a >= 224 && a <= 239) return "multicast";
  if (a >= 240) return "reserved";
  return "public";
}

function prefixMatches(bytes, prefix, bits) {
  const fullBytes = Math.floor(bits / 8);
  const remainingBits = bits % 8;
  for (let index = 0; index < fullBytes; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  if (!remainingBits) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (bytes[fullBytes] & mask) === (prefix[fullBytes] & mask);
}

function ipv6Prefix(value) {
  const parsed = parseIpv6(value);
  if (!parsed) throw new Error(`无效的 IPv6 前缀: ${value}`);
  return parsed;
}

const IPV6_PREFIXES = {
  documentation: ipv6Prefix("2001:db8::"),
  linkLocal: ipv6Prefix("fe80::"),
  multicast: ipv6Prefix("ff00::"),
  private: ipv6Prefix("fc00::"),
  special: ipv6Prefix("2001::"),
  translation: ipv6Prefix("64:ff9b::"),
  translationLocal: ipv6Prefix("64:ff9b:1::"),
  tunnel: ipv6Prefix("2002::"),
};

function classifyIpv6(address) {
  const bytes = parseIpv6(address);
  if (!bytes) return "invalid";
  if (bytes.every((byte) => byte === 0)) return "unspecified";
  if (bytes.subarray(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return "loopback";

  const firstTwelveZero = bytes.subarray(0, 12).every((byte) => byte === 0);
  const ipv4Mapped =
    bytes.subarray(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (firstTwelveZero || ipv4Mapped) {
    return classifyIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }
  if (prefixMatches(bytes, IPV6_PREFIXES.translation, 96)) {
    return classifyIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }
  if (prefixMatches(bytes, IPV6_PREFIXES.translationLocal, 48)) return "reserved";
  if (prefixMatches(bytes, IPV6_PREFIXES.tunnel, 16)) {
    return classifyIpv4(`${bytes[2]}.${bytes[3]}.${bytes[4]}.${bytes[5]}`);
  }
  if (prefixMatches(bytes, IPV6_PREFIXES.private, 7)) return "private";
  if (prefixMatches(bytes, IPV6_PREFIXES.linkLocal, 10)) return "link-local";
  if (prefixMatches(bytes, IPV6_PREFIXES.multicast, 8)) return "multicast";
  if (prefixMatches(bytes, IPV6_PREFIXES.documentation, 32)) return "documentation";
  if (prefixMatches(bytes, IPV6_PREFIXES.special, 23)) return "reserved";
  return "public";
}

function classifyIpAddress(address) {
  const normalized = normalizeHostname(address);
  const family = net.isIP(normalized);
  if (family === 4) return classifyIpv4(normalized);
  if (family === 6) return classifyIpv6(normalized);
  return "invalid";
}

function normalizeLookupRecords(result) {
  const values = Array.isArray(result) ? result : [result];
  return values.filter(Boolean).map((record) => {
    if (typeof record === "string") {
      return { address: record, family: net.isIP(record) };
    }
    return { address: String(record.address || ""), family: Number(record.family) };
  });
}

/**
 * @param {URL} endpoint
 * @param {{lookup?: (hostname: string, options: {all: true, verbatim: true}) => Promise<unknown>}} [options]
 */
async function resolveEndpoint(endpoint, options = {}) {
  const lookup = options.lookup || dns.promises.lookup;
  const hostname = normalizeHostname(endpoint.hostname);
  const literalFamily = net.isIP(hostname);
  const records = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : normalizeLookupRecords(await lookup(hostname, { all: true, verbatim: true }));
  if (!records.length) throw new Error("接口域名没有可用的 DNS 解析结果");

  const explicitLoopback = isLoopbackHostname(hostname);
  for (const record of records) {
    const actualFamily = net.isIP(record.address);
    if (
      !actualFamily ||
      (record.family !== 4 && record.family !== 6) ||
      record.family !== actualFamily
    ) {
      throw new Error("接口域名返回了无效的 DNS 解析结果");
    }
    const category = classifyIpAddress(record.address);
    if (explicitLoopback ? category !== "loopback" : category !== "public") {
      throw new Error(`接口地址解析到禁止访问的 ${category} 网络`);
    }
  }
  return records[0];
}

function createPinnedLookup(record) {
  const pinned = { address: record.address, family: record.family };
  return (_hostname, options, callback) => {
    const done = typeof options === "function" ? options : callback;
    if (typeof done !== "function") throw new TypeError("DNS lookup callback is required");
    if (typeof options !== "function" && options && options.all) {
      done(null, [pinned]);
      return;
    }
    done(null, pinned.address, pinned.family);
  };
}

function endpointRequestOptions(endpoint, record) {
  const hostname = normalizeHostname(endpoint.hostname);
  return {
    agent: false,
    hostname,
    port: endpoint.port || undefined,
    path: endpoint.pathname + endpoint.search,
    lookup: createPinnedLookup(record),
    ...(endpoint.protocol === "https:" && net.isIP(hostname) === 0 ? { servername: hostname } : {}),
  };
}

module.exports = {
  classifyIpAddress,
  createPinnedLookup,
  endpointRequestOptions,
  isLoopbackHostname,
  normalizeHostname,
  parseEndpoint,
  resolveEndpoint,
};
