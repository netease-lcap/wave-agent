import { describe, it, expect } from "vitest";
import {
  DIFF_COLLAPSE_THRESHOLD,
  DIFF_WORD_HIGHLIGHT_LIMIT,
  isTestPath,
  nextExpandedPath,
  parseHunks,
  totalChangedLines,
  type DiffRow,
} from "../../src/utils/diffHunks";

/** [kind, old line, new line] per row — the whole structure in one glance. */
const shape = (rows: DiffRow[]) =>
  rows.map((row) => [row.kind, row.old?.line ?? null, row.new?.line ?? null]);

describe("parseHunks", () => {
  it("pairs removed/added lines by position and leaves the surplus unpaired", () => {
    const rows = parseHunks(
      [
        "@@ -1,4 +1,5 @@ function foo() {",
        " const a = 1;",
        "-const b = 2;",
        "+const b = 3;",
        "+const c = 4;",
        " const d = 5;",
      ].join("\n"),
    );

    expect(shape(rows)).toEqual([
      ["hunk", null, null],
      ["context", 1, 1],
      ["pair", 2, 2],
      ["added", null, 3],
      ["context", 3, 4],
    ]);
    expect(rows[2].old?.text).toBe("const b = 2;");
    expect(rows[2].new?.text).toBe("const b = 3;");
  });

  it("keeps the raw line index on both sides of a pair (comment target id)", () => {
    const rows = parseHunks(["@@ -1,1 +1,1 @@", "-old", "+new"].join("\n"));

    const pair = rows[1];
    expect(pair.kind).toBe("pair");
    expect(pair.old?.index).toBe(1);
    expect(pair.new?.index).toBe(2);
  });

  it("reads a hunk header with a trailing section title and omitted counts", () => {
    const rows = parseHunks(
      ["@@ -10 +20 @@ export function render() {", "-old", "+new"].join("\n"),
    );

    expect(rows[0]).toMatchObject({
      kind: "hunk",
      header: "@@ -10 +20 @@ export function render() {",
    });
    // Both counters come from the single-number form.
    expect(shape(rows)).toEqual([
      ["hunk", null, null],
      ["pair", 10, 20],
    ]);
  });

  it("numbers a header-less diff (untracked file) from line 1", () => {
    const rows = parseHunks(["+one", "+two", "+three"].join("\n"));

    expect(shape(rows)).toEqual([
      ["added", null, 1],
      ["added", null, 2],
      ["added", null, 3],
    ]);
  });

  it("turns the no-newline marker into its own row and ends the run", () => {
    const rows = parseHunks(
      [
        "@@ -1,1 +1,1 @@",
        "-old",
        "\\ No newline at end of file",
        "+new",
        "\\ No newline at end of file",
      ].join("\n"),
    );

    expect(shape(rows)).toEqual([
      ["hunk", null, null],
      ["removed", 1, null],
      ["no-newline", null, null],
      ["added", null, 1],
      ["no-newline", null, null],
    ]);
  });

  it("tracks the two sides independently across hunks", () => {
    const rows = parseHunks(
      [
        "@@ -1,2 +1,2 @@",
        " keep",
        "-gone",
        "+fresh",
        "@@ -8,1 +8,1 @@",
        " tail",
      ].join("\n"),
    );

    expect(shape(rows)).toEqual([
      ["hunk", null, null],
      ["context", 1, 1],
      ["pair", 2, 2],
      ["hunk", null, null],
      ["context", 8, 8],
    ]);
  });

  it("treats a bare line without marker as context", () => {
    // Defensive: a synthetic diff may omit the leading space.
    const rows = parseHunks(["@@ -1,1 +1,1 @@", "bare"].join("\n"));

    expect(shape(rows)).toEqual([
      ["hunk", null, null],
      ["context", 1, 1],
    ]);
    expect(rows[1].new?.text).toBe("bare");
  });

  it("returns nothing for an empty diff", () => {
    expect(parseHunks("")).toEqual([]);
  });
});

describe("isTestPath", () => {
  it.each([
    "tests/foo.test.ts",
    "packages/x/tests/y.test.ts",
    "src/tests/a.ts",
    "src/__tests__/b.tsx",
    "__mocks__/fs.ts",
    "src/__snapshots__/tree.ts.snap",
    "Button.snap",
    "foo.spec.ts",
    "e2e/desktop.e2e.ts",
    "app_test.go",
    "test_utils.py",
    "ButtonTests.cs",
  ])("treats %s as a test", (path) => {
    expect(isTestPath(path)).toBe(true);
  });

  it.each([
    "src/utils/diffHunks.ts",
    "packages/webview/src/components/DiffPane.tsx",
    "docs/specs/desktop/desktop-panels.md",
    "src/latest.ts",
    "src/testing/helpers.ts",
    "src/snapshotStore.ts",
    "protest.md",
  ])("does not treat %s as a test", (path) => {
    expect(isTestPath(path)).toBe(false);
  });
});

describe("totalChangedLines", () => {
  it("sums additions and deletions across the range", () => {
    expect(
      totalChangedLines([
        { additions: 3, deletions: 1 },
        { additions: 0, deletions: 0 },
        { additions: 10, deletions: 4 },
      ]),
    ).toBe(18);
  });

  it("is zero for an empty range", () => {
    expect(totalChangedLines([])).toBe(0);
  });
});

describe("nextExpandedPath", () => {
  const files = [{ path: "src/a.ts" }, { path: "tests/b.test.ts" }];

  it("picks the first non-test file on the first result", () => {
    expect(nextExpandedPath(undefined, files, false)).toBe("src/a.ts");
    expect(
      nextExpandedPath(undefined, [{ path: "tests/b.test.ts" }], false),
    ).toBe("tests/b.test.ts");
  });

  it("keeps an explicit choice across refreshes", () => {
    expect(nextExpandedPath("tests/b.test.ts", files, false)).toBe(
      "tests/b.test.ts",
    );
  });

  it("keeps the user's 'all collapsed' state (null is not 'never chosen')", () => {
    // Without this the generation-end auto-refresh re-expands a file the user
    // had deliberately collapsed.
    expect(nextExpandedPath(null, files, false)).toBeNull();
  });

  it("falls back to the default when the expanded file is gone", () => {
    expect(nextExpandedPath("src/gone.ts", files, false)).toBe("src/a.ts");
  });

  it("collapses everything for an oversized range", () => {
    // No default applies, but that is NOT the same as the user collapsing
    // everything: a later small range must still get its default file.
    expect(nextExpandedPath(undefined, files, true)).toBeUndefined();
    // A still-existing explicit choice survives the collapse-all default.
    expect(nextExpandedPath("src/a.ts", files, true)).toBe("src/a.ts");
  });

  it("stays undecided when the range has no files", () => {
    expect(nextExpandedPath("src/a.ts", [], false)).toBeUndefined();
  });
});

describe("degradation thresholds", () => {
  it("orders the layers row threshold > word-highlight threshold", () => {
    expect(DIFF_COLLAPSE_THRESHOLD).toBeGreaterThan(DIFF_WORD_HIGHLIGHT_LIMIT);
  });
});
