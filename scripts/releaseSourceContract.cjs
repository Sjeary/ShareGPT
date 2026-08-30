/**
 * @param {{
 *   refType?: string,
 *   sha?: string,
 *   isAncestor?: (sha: string, branch: string) => boolean
 * }} [input]
 */
function releaseSourceFailures({ refType = "", sha = "", isAncestor } = {}) {
  if (String(refType).trim() !== "tag") return [];
  const commit = String(sha || "").trim();
  if (!commit) return ["release source: tag commit SHA is required"];
  if (typeof isAncestor !== "function") {
    return ["release source: origin/main ancestry checker is required"];
  }
  return isAncestor(commit, "origin/main")
    ? []
    : [`release source: tag commit ${commit} is not contained in origin/main`];
}

module.exports = { releaseSourceFailures };
