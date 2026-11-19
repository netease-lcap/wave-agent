/**
 * Version-control metadata directories, excluded from every search path.
 *
 * One list, three consumers: the Grep tool's ripgrep invocation, the Glob tool
 * (ripgrep with `--no-ignore`, which would otherwise walk `.git` like any other
 * directory), and the Bash tool's `grep` / `find` shadows (`searchShell.ts`).
 *
 * They are excluded because their contents are noise for a code search — and in
 * a worktree because `.git` is a pointer file whose real object store sits
 * elsewhere, so following it describes a repository the user is not looking at.
 */
export const VCS_DIRECTORIES = [
  ".git",
  ".svn",
  ".hg",
  ".bzr",
  ".jj",
  ".sl",
] as const;
