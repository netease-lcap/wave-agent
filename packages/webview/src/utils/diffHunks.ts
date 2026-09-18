/**
 * Parsed-hunk model shared by the desktop diff pane's unified and side-by-side
 * renderers. Pure data (no React) on purpose: both views must read the SAME
 * pairing result, otherwise the word-level highlight of a pair would drift
 * between views — the spec requires a view switch to change nothing but layout.
 */

/** Range total (additions + deletions) above which no file expands by default. */
export const DIFF_COLLAPSE_THRESHOLD = 5000;
/** Per-file total above which word-level pairing is skipped (line level only). */
export const DIFF_WORD_HIGHLIGHT_LIMIT = 1000;
/** Sidebar width: file tree, with the commit list under it. */
export const DIFF_TREE_WIDTH = 240;
/**
 * Narrowest diff column still worth rendering next to the sidebar. Below
 * DIFF_TREE_WIDTH + this the sidebar auto-hides (spec「文件树与导航」场景 5):
 * the threshold must stay under the panel's minimum width (320) plus the tree,
 * otherwise the tree could never be shown at any supported panel width.
 */
export const DIFF_MIN_DIFF_WIDTH = 180;

export type DiffRowKind =
  | "hunk"
  | "context"
  | "removed"
  | "added"
  | "pair"
  | "no-newline";

export interface DiffRowSide {
  /**
   * Raw line index inside the hunks text. Unique within one file, so it doubles
   * as the React key and as the comment-target id (`diff-comment-add-<index>`,
   * which the existing tests pin).
   */
  index: number;
  /** Line content without the leading +/-/space marker. */
  text: string;
  /** 1-based line number on this side, or null when this side has no line. */
  line: number | null;
}

export interface DiffRow {
  kind: DiffRowKind;
  key: string;
  /** kind === "hunk": the raw `@@ … @@` header, trailing section title included. */
  header?: string;
  /** kind === "no-newline": the raw `\ No newline at end of file` marker. */
  marker?: string;
  /** Old-file side — set for removed / pair / context rows. */
  old?: DiffRowSide;
  /** New-file side — set for added / pair / context rows. */
  new?: DiffRowSide;
}

/**
 * Hunk header. Deliberately not anchored at the end (`@@ fn foo() {` section
 * titles and test fixtures both appear after the closing `@@`) and the counts
 * are optional (git omits them when a side is exactly one line).
 */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Split one file's hunks into render rows. Removed and added lines are paired
 * by position so the two sides of a change sit on one row
 * (`kind === "pair"`); unpaired lines stand alone. Anything that is not a
 * +/- line ends the current run, exactly like the message-list diff block.
 *
 * Line numbers are tracked per side: a hunk header resets both counters, a
 * header-less diff (an untracked file, whose whole content is synthetic `+`
 * lines) starts at 1 so those lines read as lines 1..N.
 */
export function parseHunks(hunks: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  let pendingRemoved: DiffRowSide[] = [];
  let pendingAdded: DiffRowSide[] = [];

  const flush = () => {
    const maxLines = Math.max(pendingRemoved.length, pendingAdded.length);
    for (let i = 0; i < maxLines; i++) {
      const oldSide = pendingRemoved[i];
      const newSide = pendingAdded[i];
      if (oldSide && newSide) {
        rows.push({
          kind: "pair",
          key: String(oldSide.index),
          old: oldSide,
          new: newSide,
        });
      } else if (oldSide) {
        rows.push({
          kind: "removed",
          key: String(oldSide.index),
          old: oldSide,
        });
      } else if (newSide) {
        rows.push({ kind: "added", key: String(newSide.index), new: newSide });
      }
    }
    pendingRemoved = [];
    pendingAdded = [];
  };

  hunks.split("\n").forEach((line, index) => {
    // Every real diff line carries a marker, so an empty raw line is only ever
    // the artifact of splitting an empty/trailing-newline text.
    if (line === "") return;
    if (line.startsWith("+")) {
      pendingAdded.push({ index, text: line.slice(1), line: newLine++ });
      return;
    }
    if (line.startsWith("-")) {
      pendingRemoved.push({ index, text: line.slice(1), line: oldLine++ });
      return;
    }
    // Trailing "no newline" marker and hunk headers end the current run.
    flush();
    if (line.startsWith("\\")) {
      rows.push({ kind: "no-newline", key: String(index), marker: line });
      return;
    }
    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      rows.push({ kind: "hunk", key: String(index), header: line });
      return;
    }
    const text = line.startsWith(" ") ? line.slice(1) : line;
    rows.push({
      kind: "context",
      key: String(index),
      old: { index, text, line: oldLine++ },
      new: { index, text, line: newLine++ },
    });
  });
  flush();
  return rows;
}

// Spec「文件树与导航」场景 3 lists the shapes that count as tests: a
// `__tests__` / `__snapshots__` directory segment, or a `*.test.*` /
// `*.spec.*` / `test_*.py` / `*.snap` file name. `specs/` is deliberately
// absent from the directory list: this repo keeps its specifications under
// `docs/specs/`, and `*.spec.ts` is covered by the file-name rule below.
const TEST_DIR = /^(?:tests?|__tests__|__mocks__|__snapshots__|e2e|cypress)$/i;
const TEST_FILE =
  /(?:^|[.\-_])(?:tests?|specs?|e2e)\.|(?:Test|Tests|Spec|Specs)\.|^(?:test_.*|conftest)\.[^.]*$|\.snap$/;

/** True for paths whose own contents are tests (they are not auto-expanded first). */
export function isTestPath(path: string): boolean {
  const segments = path.split("/");
  const name = segments[segments.length - 1] ?? "";
  if (segments.slice(0, -1).some((segment) => TEST_DIR.test(segment)))
    return true;
  return TEST_FILE.test(name);
}

/** Range total used by every degradation threshold (additions + deletions). */
export function totalChangedLines(
  files: readonly { additions: number; deletions: number }[],
): number {
  return files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
}

/**
 * Which file the accordion shows after a result arrives.
 *
 * Three inputs, three outcomes:
 * - `null` — the user collapsed everything; keep it collapsed.
 * - a path that still exists in the new range — keep it (spec「变更基准」场景 9:
 *   a refresh must not move the expanded file; it also covers switching to a
 *   range where the same file is still touched).
 * - `undefined` — nobody has decided yet, so the default rule runs; it answers
 *   `undefined` again (still undecided, NOT "collapsed") when there is nothing
 *   to pick — an empty range, or a range too large to expand by default
 *   (spec「视图切换与大规模差异降级」场景 5). Recording that as an explicit
 *   collapse would leave a *later*, small range needlessly collapsed.
 */
export function nextExpandedPath(
  prev: string | null | undefined,
  files: readonly { path: string }[],
  collapseAll: boolean,
): string | null | undefined {
  if (prev === null) return null;
  if (prev !== undefined && files.some((file) => file.path === prev))
    return prev;
  if (files.length === 0) return undefined;
  if (collapseAll) return undefined;
  return (files.find((file) => !isTestPath(file.path)) ?? files[0]).path;
}
