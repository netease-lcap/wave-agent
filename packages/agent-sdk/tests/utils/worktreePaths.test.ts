import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  findWorktreeMapping,
  relativeToBase,
  relativizeTriggerPath,
  resetWorktreePathCache,
  toCheckoutPath,
  toWorktreePath,
} from "../../src/utils/worktreePaths.js";

vi.mock("node:fs", () => ({
  statSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Fixture: a checkout with one linked worktree nested inside it, described the
// way git describes it on disk (`<worktree>/.git` is a gitfile pointing at
// `<checkout>/.git/worktrees/<name>`).
const CHECKOUT = path.resolve("/repo");
const WORKTREE = path.join(CHECKOUT, ".wave", "worktrees", "wt");
const WORKTREE_GITFILE = path.join(WORKTREE, ".git");
const OUTSIDE = path.resolve("/elsewhere");

function givenWorktreeGitfile(): void {
  vi.mocked(fs.statSync).mockImplementation((p) => {
    if (String(p) === WORKTREE_GITFILE) {
      return { isFile: () => true } as unknown as ReturnType<
        typeof fs.statSync
      >;
    }
    throw Object.assign(new Error(`ENOENT: ${String(p)}`), {
      code: "ENOENT",
    });
  });
  vi.mocked(fs.readFileSync).mockImplementation((p) => {
    if (String(p) === WORKTREE_GITFILE) {
      return `gitdir: ${path.join(CHECKOUT, ".git", "worktrees", "wt")}\n`;
    }
    throw Object.assign(new Error(`ENOENT: ${String(p)}`), {
      code: "ENOENT",
    });
  });
}

describe("worktreePaths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWorktreePathCache();
    givenWorktreeGitfile();
  });

  describe("relativeToBase", () => {
    it("returns a forward-slash path inside the base", () => {
      expect(relativeToBase(path.join(CHECKOUT, "src", "a.ts"), CHECKOUT)).toBe(
        "src/a.ts",
      );
    });

    it("returns null for a path outside the base instead of a ..-prefixed path", () => {
      expect(relativeToBase(path.join(OUTSIDE, "a.ts"), CHECKOUT)).toBe(null);
    });

    it("returns null for the base itself", () => {
      expect(relativeToBase(CHECKOUT, CHECKOUT)).toBe(null);
    });
  });

  describe("findWorktreeMapping", () => {
    it("finds the checkout that owns a linked worktree", () => {
      expect(
        findWorktreeMapping(path.join(WORKTREE, "src", "a.ts"), CHECKOUT),
      ).toEqual({ worktreeRoot: WORKTREE, checkout: CHECKOUT });
    });

    it("returns null when the file already sits inside the base", () => {
      expect(
        findWorktreeMapping(path.join(CHECKOUT, "src", "a.ts"), CHECKOUT),
      ).toBe(null);
    });

    it("returns null when the worktree belongs to an unrelated checkout", () => {
      expect(
        findWorktreeMapping(path.join(WORKTREE, "src", "a.ts"), OUTSIDE),
      ).toBe(null);
    });

    it("maps paths in both directions", () => {
      const mapping = { worktreeRoot: WORKTREE, checkout: CHECKOUT };
      expect(toCheckoutPath(path.join(WORKTREE, "src", "a.ts"), mapping)).toBe(
        path.join(CHECKOUT, "src", "a.ts"),
      );
      expect(toWorktreePath(path.join(CHECKOUT, "src", "a.ts"), mapping)).toBe(
        path.join(WORKTREE, "src", "a.ts"),
      );
      // Paths already on the requested side are returned unchanged.
      expect(toCheckoutPath(path.join(OUTSIDE, "a.ts"), mapping)).toBe(
        path.join(OUTSIDE, "a.ts"),
      );
    });
  });

  describe("relativizeTriggerPath", () => {
    it("maps a worktree file back to its checkout-relative path", () => {
      expect(
        relativizeTriggerPath(path.join(WORKTREE, "src", "a.ts"), CHECKOUT),
      ).toBe("src/a.ts");
    });

    it("treats non-absolute input as already base-relative", () => {
      expect(relativizeTriggerPath("src/a.ts", CHECKOUT)).toBe("src/a.ts");
      expect(relativizeTriggerPath("./src/a.ts", CHECKOUT)).toBe("src/a.ts");
      expect(relativizeTriggerPath("../outside/a.ts", CHECKOUT)).toBe(null);
    });

    it("returns null for a file unrelated to the base", () => {
      expect(relativizeTriggerPath(path.join(OUTSIDE, "a.ts"), CHECKOUT)).toBe(
        null,
      );
    });
  });
});
