const crypto = require("node:crypto");

function yamlScalar(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {}
  }
  if (text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

function topLevelScalar(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return yamlScalar(
    String(text || "").match(new RegExp(`^${escaped}:[ \\t]*(.*?)[ \\t]*$`, "m"))?.[1],
  );
}

function parseLatestWindowsYaml(text) {
  const source = String(text || "");
  const filesBlock = source.match(/^files:\s*\r?\n((?:[ \t].*(?:\r?\n|$))*)/m)?.[1] || "";
  const files = [];
  let current = null;
  for (const line of filesBlock.split(/\r?\n/)) {
    const first = line.match(/^\s*-\s+url:\s*(.*?)\s*$/);
    if (first) {
      current = { url: yamlScalar(first[1]), sha512: "", size: 0 };
      files.push(current);
      continue;
    }
    if (!current) continue;
    const field = line.match(/^\s+(sha512|size):\s*(.*?)\s*$/);
    if (!field) continue;
    if (field[1] === "sha512") current.sha512 = yamlScalar(field[2]);
    if (field[1] === "size") current.size = Number(yamlScalar(field[2]));
  }
  return {
    version: topLevelScalar(source, "version"),
    path: topLevelScalar(source, "path"),
    sha512: topLevelScalar(source, "sha512"),
    files,
  };
}

function sha512Base64(data) {
  return crypto.createHash("sha512").update(data).digest("base64");
}

function assertLatestWindowsContract(text, expected) {
  const metadata = parseLatestWindowsYaml(text);
  const version = String(expected?.version || "").trim();
  const installerName = String(expected?.installerName || "").trim();
  const installerSize = Number(expected?.installerSize);
  const installerSha512 = String(expected?.installerSha512 || "").trim();
  if (metadata.version !== version) throw new Error(`latest.yml 版本号不是 ${version}`);
  if (metadata.path !== installerName)
    throw new Error(`latest.yml path 未精确指向 ${installerName}`);
  if (metadata.files.length !== 1 || metadata.files[0].url !== installerName) {
    throw new Error(`latest.yml files 必须只包含 ${installerName}`);
  }
  if (metadata.files[0].size !== installerSize) {
    throw new Error(`latest.yml size=${metadata.files[0].size}，实际安装包=${installerSize}`);
  }
  if (!installerSha512 || metadata.sha512 !== installerSha512) {
    throw new Error("latest.yml 顶层 sha512 与安装包不一致");
  }
  if (metadata.files[0].sha512 !== installerSha512) {
    throw new Error("latest.yml files.sha512 与安装包不一致");
  }
  return metadata;
}

function parsePublisherNames(text) {
  const source = String(text || "");
  const inline = source.match(/^publisherName:[ \t]*(.*?)[ \t]*$/m)?.[1];
  if (inline && yamlScalar(inline)) return [yamlScalar(inline)];
  const block = source.match(/^publisherName:\s*\r?\n((?:[ \t].*(?:\r?\n|$))*)/m)?.[1] || "";
  return block
    .split(/\r?\n/)
    .map((line) => yamlScalar(line.match(/^\s*-\s*(.*?)\s*$/)?.[1]))
    .filter(Boolean);
}

function assertWindowsAppUpdateContract(text, options = {}) {
  const source = String(text || "");
  const provider = topLevelScalar(source, "provider");
  const owner = topLevelScalar(source, "owner");
  const repo = topLevelScalar(source, "repo");
  const publisherNames = parsePublisherNames(source);
  if (provider !== "github")
    throw new Error(`app-update.yml provider 必须是 github，当前为 ${provider}`);
  if (owner !== "Sjeary") throw new Error(`app-update.yml owner 必须是 Sjeary，当前为 ${owner}`);
  if (repo !== "ShareGPT") throw new Error(`app-update.yml repo 必须是 ShareGPT，当前为 ${repo}`);
  const expectedPublisherName = String(options.expectedPublisherName || "").trim();
  if (options.requirePublisherIdentity && !expectedPublisherName) {
    throw new Error("正式发布必须提供 SHAREGPT_EXPECTED_WINDOWS_PUBLISHER");
  }
  if (expectedPublisherName && !publisherNames.includes(expectedPublisherName)) {
    throw new Error(
      `app-update.yml publisherName 与正式发布者不一致：expected=${expectedPublisherName}`,
    );
  }
  return { owner, provider, publisherNames, repo };
}

module.exports = {
  assertLatestWindowsContract,
  assertWindowsAppUpdateContract,
  parseLatestWindowsYaml,
  parsePublisherNames,
  sha512Base64,
};
