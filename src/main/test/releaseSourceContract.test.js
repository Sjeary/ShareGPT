const test = require("node:test");
const assert = require("node:assert/strict");
const { releaseSourceFailures } = require("../../../scripts/releaseSourceContract.cjs");

test("tag releases require a commit contained in origin/main", () => {
  assert.deepEqual(
    releaseSourceFailures({
      refType: "tag",
      sha: "abc123",
      isAncestor: (sha, branch) => sha === "abc123" && branch === "origin/main",
    }),
    [],
  );
  assert.match(
    releaseSourceFailures({ refType: "tag", sha: "bad", isAncestor: () => false })[0],
    /not contained in origin\/main/,
  );
  assert.match(releaseSourceFailures({ refType: "tag", sha: "" })[0], /SHA is required/);
});

test("manual non-tag release verification does not claim main ancestry", () => {
  assert.deepEqual(releaseSourceFailures({ refType: "branch", sha: "feature" }), []);
});
