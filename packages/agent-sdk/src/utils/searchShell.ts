import type { SearchToolPaths } from "./searchTools.js";
import { getSearchTools } from "./searchTools.js";
import { getRgPath } from "./ripgrep.js";

/**
 * The shell prelude that makes wave's own search binaries win over the system
 * ones inside the Bash tool (`core/bash-tools.md`, `core/fs-tools.md`).
 *
 * ## Why shell functions rather than a PATH shim
 *
 * A function is visible only to the command line the model wrote; anything that
 * re-executes `grep` in a *new* context (`xargs grep`, `timeout grep`,
 * `find -exec grep`, a nested `bash -c 'grep ...'`) gets the system binary. That
 * is the intended split (`bash-tools.md`, scenario 2): the common case gets
 * .gitignore-aware search, and the escape hatch that would otherwise need our
 * wrapper to behave perfectly under `-print0` / `exec` keeps GNU semantics.
 * Exporting the functions (`export -f`) would erase that line, so they are
 * deliberately not exported.
 *
 * ## What each shadow injects, and why
 *
 * `grep` → ugrep, with GNU grep's regex dialect and the Grep tool's file
 * filtering:
 * - `-G`: GNU grep defaults to BRE (`\|` is alternation). ugrep defaults to ERE,
 *   where `\|` is a literal pipe, so `grep "foo\|bar"` would silently match
 *   nothing. A later `-E` / `-F` / `-P` from the caller still wins.
 * - `--ignore-files`: respect `.gitignore`, matching the Grep tool (rg's
 *   default).
 * - `--hidden`: include hidden files, matching the Grep tool's `--hidden`.
 * - `-I`: skip binary files, matching rg's silent recursion skip.
 * - `--exclude-dir` / `--exclude` for the VCS names the Grep tool excludes: the
 *   directory form for the usual `.git/`, the file form for a *worktree*, where
 *   `.git` is a pointer file (`gitdir: …`) that `--exclude-dir` leaves behind —
 *   searching from a worktree root would otherwise report `.git:1:gitdir: …`.
 *   ripgrep excludes the name outright (`--glob '!.git'`), so this is what makes
 *   the two agree.
 *
 * `find` → bfs, with `-S dfs` to keep traversal order predictable, and
 * `-regextype findutils-default` because bfs's default regex dialect is POSIX
 * BRE while GNU find's is the *emacs* flavour, where `\|` is alternation
 * (`find . -regex '.*\.\(js\|ts\)'` silently matches nothing under BRE). bfs
 * can only offer that flavour when it is built against Oniguruma, which is why
 * the shipped binary carries one; a caller-supplied `-regextype` later in argv
 * still wins. `-name` / `-path` are globs and mean the same thing everywhere.
 *
 * `rg` → wave's ripgrep, but *only when the system has no `rg` at all*: a user
 * with ripgrep installed keeps theirs (`bash-tools.md`, scenario 3).
 *
 * ## Falling back
 *
 * Two ways a shadow declines and runs the system command instead: the caller
 * passed a flag the binary cannot honour faithfully (the grep deny list —
 * `--null`, `--filter`, `--config` and friends), or the binary is not where the
 * package promised it (a half-finished install). Falling back is always silent:
 * a search that loses .gitignore semantics still returns results (scenario 7).
 *
 * ## Windows
 *
 * `grep` is shadowed there too: msys ships GNU grep, which has no `.gitignore`
 * concept at all, so a repo-root `grep -r` drags in `dist/`, `node_modules/` and
 * every sibling worktree (measured: ~52s and 4× the files versus ugrep's 0.3s).
 * Windows packs ugrep only — bfs has no Windows build, and msys `find` already
 * *is* GNU find, which is the semantics the find shadow imitates.
 */

/** VCS names the Grep tool excludes; mirrored here so bash matches it. */
const VCS_DIRECTORIES = [".git", ".svn", ".hg", ".bzr", ".jj", ".sl"];

/**
 * grep arguments ugrep must not interpret: output formats the caller's pipeline
 * depends on (`--null`, `--null-data`, and their `-Z`/`-z` aliases), and the
 * ugrep flags that read or execute something outside this process (`--config`,
 * `-@file`, `--filter`, `--pager`, `--view`, `--format-open`, `--save-config`).
 * Matching is `case`-glob, so `-*-filter*` catches `--filter=` and
 * `-[!-]*[Zz]*` catches a combined short option such as `-rZ`.
 */
const GREP_DENY_PATTERNS = [
  "-*-filter*",
  "-*-pager*",
  "-*-view*",
  "-*-format-open*",
  "-*-config*",
  "---*",
  "-@*",
  "-*-save-config*",
  "-[Zz]*",
  "-[!-]*[Zz]*",
  "--null",
  "--null-data",
];

/** Single-quote a word for the shell, escaping embedded quotes. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * A path as the shell on [platform] wants it. Git Bash accepts forward slashes
 * for a Windows path; backslashes reach bash as escape characters.
 */
function toShellPath(value: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? value.replace(/\\/g, "/") : value;
}

/**
 * `"$@"`, spelled so that zero arguments expand to zero words rather than an
 * empty one — the difference between `grep -n foo` and `grep -n foo ''`.
 */
const ARGS = '${1+"$@"}';

/**
 * One shadow function.
 *
 * The deny-list scan comes first and costs one `case` per argument. The
 * `-x` check is the installer-raced case: the package resolved, but the file it
 * pointed at is gone or not executable.
 */
function shadowFunction(options: {
  name: string;
  binaryPath: string;
  platform: NodeJS.Platform;
  /**
   * argv[0] the binary dispatches on (`ugrep` reads it; bfs ignores it).
   *
   * Inert on Windows: `exec -a` cannot override argv[0] for a native binary
   * (Windows sets it to the executable path), so ugrep runs in its own mode
   * there. The injected `-G` is what keeps the regex dialect identical, and
   * ugrep's default output is already `file:line:content`.
   */
  argv0: string;
  prependArgs: string[];
  denyPatterns: string[];
}): string {
  const { name, binaryPath, platform, argv0, prependArgs, denyPatterns } =
    options;
  const binary = shellQuote(toShellPath(binaryPath, platform));
  const args = [...prependArgs.map(shellQuote), ARGS].join(" ");
  const lines = [`function ${name} {`];

  if (denyPatterns.length > 0) {
    lines.push(
      `  local _wave_arg`,
      `  for _wave_arg in ${ARGS}; do`,
      `    case "$_wave_arg" in ${denyPatterns.join("|")}) command ${name} ${ARGS}; return ;; esac`,
      `  done`,
    );
  }

  lines.push(
    `  local _wave_bin=${binary}`,
    `  if [[ ! -x $_wave_bin ]]; then command ${name} ${ARGS}; return; fi`,
    `  if [[ -n \${ZSH_VERSION:-} ]]; then`,
    `    ARGV0=${argv0} "$_wave_bin" ${args}`,
    `  else`,
    // A subshell: `exec -a` replaces the process image, which must happen to
    // the command, not to the shell running the rest of the model's line.
    `    ( exec -a ${argv0} "$_wave_bin" ${args} )`,
    `  fi`,
    `}`,
  );
  return lines.join("\n");
}

/**
 * `rg` exists only if the user does not already have one — checked at call
 * time, since a function defined later would shadow nothing and an alias would
 * not have expanded in a non-interactive shell either way.
 */
function rgFunction(rgPath: string, platform: NodeJS.Platform): string {
  return [
    `if ! command -v rg >/dev/null 2>&1; then`,
    `  function rg { command ${shellQuote(toShellPath(rgPath, platform))} ${ARGS}; }`,
    `fi`,
  ].join("\n");
}

/**
 * Build the prelude prepended to every Bash tool command, or `undefined` when
 * this platform / install gets no shadows at all.
 *
 * Both shadows follow what the platform package actually ships rather than a
 * per-platform policy: `grep` is shadowed wherever a ugrep resolved (Windows
 * included — its msys grep has no `.gitignore` support), `find` wherever a bfs
 * did (never Windows; msys `find` already is GNU find). `rg` is offered on every
 * platform.
 *
 * All inputs are injectable so the shape of the generated script can be tested
 * per platform without a real install.
 */
export function buildSearchShellPrelude(options?: {
  platform?: NodeJS.Platform;
  tools?: SearchToolPaths;
  rgPath?: string;
}): string | undefined {
  const platform = options?.platform ?? process.platform;
  // `in` rather than `??`: a caller that passes `tools: undefined` means "this
  // install has none", which is exactly what must not fall back to the real
  // resolution the injectable inputs exist to avoid.
  const tools =
    options && "tools" in options ? options.tools : getSearchTools();
  const rgPath = options && "rgPath" in options ? options.rgPath : getRgPath();

  const parts: string[] = [];
  // `unalias` first: an alias defined by `BASH_ENV` would otherwise win over
  // the function (bash expands aliases before looking up functions).
  if (tools?.ugrep) {
    parts.push(
      "unalias grep 2>/dev/null || true",
      shadowFunction({
        name: "grep",
        binaryPath: tools.ugrep,
        platform,
        argv0: "grep",
        prependArgs: [
          "-G",
          "--ignore-files",
          "--hidden",
          "-I",
          // Both forms: directories, and the `.git` *file* a worktree has.
          ...VCS_DIRECTORIES.flatMap((name) => [
            `--exclude-dir=${name}`,
            `--exclude=${name}`,
          ]),
        ],
        denyPatterns: GREP_DENY_PATTERNS,
      }),
    );
  }
  // Windows never resolves a bfs (the platform package ships ugrep only), so
  // the guard is documentation as much as safety: there, msys `find` already is
  // GNU find, and `bfs` has no Windows build to prefer over it.
  if (tools?.bfs && platform !== "win32") {
    parts.push(
      "unalias find 2>/dev/null || true",
      shadowFunction({
        name: "find",
        binaryPath: tools.bfs,
        platform,
        argv0: "bfs",
        prependArgs: ["-S", "dfs", "-regextype", "findutils-default"],
        denyPatterns: [],
      }),
    );
  }
  if (rgPath) parts.push(rgFunction(rgPath, platform));

  return parts.length > 0 ? parts.join("\n") : undefined;
}
