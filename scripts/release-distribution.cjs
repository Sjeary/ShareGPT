const { RELEASE_VERSION_PATTERN } = require("./releaseContract.cjs");

// Explicit version approvals, never a prefix/range or a fallback for missing credentials.
const LEGACY_VERSIONS = Object.freeze(["1.0.9", "1.0.10"]);

function releaseDistribution({ version, tag }) {
  if (!RELEASE_VERSION_PATTERN.test(version) || tag !== `v${version}`) {
    throw new Error("Distribution policy requires a matching release version and tag.");
  }
  return LEGACY_VERSIONS.includes(version) ? "legacy" : "official";
}

if (require.main === module) {
  console.log(
    releaseDistribution({
      version: require("../package.json").version,
      tag: process.env.SHAREGPT_RELEASE_TAG || process.env.GITHUB_REF_NAME,
    }),
  );
}

module.exports = { releaseDistribution };
