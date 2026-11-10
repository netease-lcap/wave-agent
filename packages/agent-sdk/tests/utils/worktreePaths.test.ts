import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  findWorktreeMapping,
  isLinkedWorktreeRoot,
  relativeToBase,
  relativizeTriggerPath,
  resetWorktreePathCache,
  toCheckoutPath,
  toWorktreePath,
} from "../../src/utils/worktreePaths.js";

vi.mock("node:fs", () => ({
  statSync: vi.fn(),
  lstatSync: vi.fn(),
  readFileSync: vi.fn(),
  // Stands in for the OS call that collapses two spellings of one directory
  // (8.3 short names, casing, symlinks). `native` is the form the module asks
  // for; the tests register the mapping they want in `realPaths`. Unregistered
  // paths throw like the real call does for a path that does not exist, so the
  // module's "resolve the deepest existing ancestor" fallback is exercised too.
  realpathSync: Object.assign((p: string) => p, {
    native: (p: string) => {
      const real = realPaths.get(p);
      if (real === undefined) {
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      }
      return real;
    },
  }),
}));

const { realPaths } = vi.hoisted(() => ({
  realPaths: new Map<string, string>(),
}));

// Fixture: a checkout with one linked worktree nested inside it, described the
// way git describes it on disk (`<worktree>/.git` is a gitfile pointing at
// `<checkout>/.git/worktrees/<name>`).
const CHECKOUT = path.resolve("/repo");
const WORKTREE = path.join(CHECKOUT, ".wave", "worktrees", "wt");
const WORKTREE_GITFILE = path.join(WORKTREE, ".git");
const WORKTREE_GIT_DIR = path.join(CHECKOUT, ".git", "worktrees", "wt");
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
  // The two chain files must be plain files (`lstatSync`, not `statSync`).
  vi.mocked(fs.lstatSync).mockImplementation((p) => {
    const requested = String(p);
    if (
      requested === path.join(WORKTREE_GIT_DIR, "commondir") ||
      requested === path.join(WORKTREE_GIT_DIR, "gitdir")
    ) {
      return { isFile: () => true } as unknown as ReturnType<
        typeof fs.lstatSync
      >;
    }
    throw Object.assign(new Error(`ENOENT: ${requested}`), {
      code: "ENOENT",
    });
  });
  vi.mocked(fs.readFileSync).mockImplementation((p) => {
    const requested = String(p);
    // `<worktree>/.git` → its git dir, plus the two files that make the chain
    // verifiable: `commondir` (→ `<checkout>/.git`) and `gitdir` (→ back to the
    // worktree's own `.git`).
    if (requested === WORKTREE_GITFILE) {
      return `gitdir: ${WORKTREE_GIT_DIR}\n`;
    }
    if (requested === path.join(WORKTREE_GIT_DIR, "commondir")) {
      return "../..\n";
    }
    if (requested === path.join(WORKTREE_GIT_DIR, "gitdir")) {
      return `${WORKTREE_GITFILE}\n`;
    }
    throw Object.assign(new Error(`ENOENT: ${requested}`), {
      code: "ENOENT",
    });
  });
}

describe("worktreePaths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWorktreePathCache();
    realPaths.clear();
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

    it("resolves a file that does not exist yet through its existing parent", () => {
      // Rule matching sees paths before they exist (a Write target, an
      // `@mention`). The plain realpath call throws for those, and keeping the
      // lexical spelling would leave exactly the short-name mismatch this
      // module erases.
      const shortSpelling = path.join(
        path.dirname(CHECKOUT),
        `${path.basename(CHECKOUT)}~1`,
      );
      realPaths.set(shortSpelling, CHECKOUT);
      realPaths.set(
        path.join(shortSpelling, "src"),
        path.join(CHECKOUT, "src"),
      );

      expect(
        relativeToBase(path.join(shortSpelling, "src", "new.ts"), CHECKOUT),
      ).toBe("src/new.ts");
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

    it("rejects a gitfile whose backlink does not point back at it", () => {
      // Both files in the chain are written by whatever repo you cloned, and a
      // recognised worktree decides whose AGENTS.md is pulled into context.
      // Borrowing another checkout's entry must not pass.
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        const requested = String(p);
        if (requested === WORKTREE_GITFILE) {
          return `gitdir: ${WORKTREE_GIT_DIR}\n`;
        }
        if (requested === path.join(WORKTREE_GIT_DIR, "commondir")) {
          return "../..\n";
        }
        if (requested === path.join(WORKTREE_GIT_DIR, "gitdir")) {
          return `${path.join(OUTSIDE, ".git")}\n`;
        }
        throw Object.assign(new Error(`ENOENT: ${requested}`), {
          code: "ENOENT",
        });
      });

      expect(
        findWorktreeMapping(path.join(WORKTREE, "src", "a.ts"), CHECKOUT),
      ).toBe(null);
    });

    it("rejects a chain whose commondir is a symlink", () => {
      // A symlinked `commondir` is a repo pointing the read somewhere else
      // while the shape still looks like a worktree.
      vi.mocked(fs.lstatSync).mockImplementation((p) => {
        if (String(p) === path.join(WORKTREE_GIT_DIR, "commondir")) {
          return {
            isFile: () => false,
            isSymbolicLink: () => true,
          } as unknown as ReturnType<typeof fs.lstatSync>;
        }
        return { isFile: () => true } as unknown as ReturnType<
          typeof fs.lstatSync
        >;
      });

      expect(
        findWorktreeMapping(path.join(WORKTREE, "src", "a.ts"), CHECKOUT),
      ).toBe(null);
    });

    it("recognises its own worktree when the base is spelled differently", () => {
      // The shape behind this: a Windows host hands over an 8.3 short name
      // (`REPO~1`) while git recorded the long one in the worktree's gitfile.
      // Lexically these are two different directories, so the mapping used to
      // miss — and a missed mapping is what let the nested walk crawl into the
      // worktree root and inject a second copy of the root memory.
      const shortSpelling = path.join(
        path.dirname(CHECKOUT),
        `${path.basename(CHECKOUT)}~1`,
      );
      realPaths.set(shortSpelling, CHECKOUT);

      expect(
        findWorktreeMapping(path.join(WORKTREE, "src", "a.ts"), shortSpelling),
      ).toEqual({ worktreeRoot: WORKTREE, checkout: CHECKOUT });
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

  describe("isLinkedWorktreeRoot", () => {
    it("recognises a directory whose .git is a gitfile", () => {
      expect(isLinkedWorktreeRoot(WORKTREE)).toBe(true);
    });

    it("rejects a plain directory", () => {
      expect(isLinkedWorktreeRoot(path.join(CHECKOUT, "src"))).toBe(false);
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
