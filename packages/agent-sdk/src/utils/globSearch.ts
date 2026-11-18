import { basename, dirname } from "path";
import { VCS_DIRECTORIES } from "./vcsDirectories.js";

/** The characters that make a path segment a pattern rather than a literal. */
const GLOB_META = /[*?[{]/;

/**
 * Split a glob into "the directory to walk" and "the pattern below it".
 *
 * ripgrep's `--glob` only understands patterns relative to the directory it
 * walks, so an absolute pattern (which the model can write, and which the
 * `path`-less form produces when it points outside the workdir) has to be cut
 * into the static part that becomes the walk root and the rest that becomes the
 * glob.
 *
 * Everything before the first special character (`* ? [ {`) is static. The cut
 * is at the last separator inside that prefix, so `src/**\/*.ts` walks `src` with
 * the pattern `**\/*.ts`, and a pattern with no glob characters degrades to
 * "walk the parent directory, match this file name".
 */
export function extractGlobBaseDirectory(pattern: string): {
  baseDir: string;
  relativePattern: string;
} {
  const match = pattern.match(GLOB_META);

  if (!match || match.index === undefined) {
    // Literal path: the file name is the pattern, its directory is the root.
    return { baseDir: dirname(pattern), relativePattern: basename(pattern) };
  }

  const staticPrefix = pattern.slice(0, match.index);
  const lastSepIndex = Math.max(
    staticPrefix.lastIndexOf("/"),
    staticPrefix.lastIndexOf("\\"),
  );

  if (lastSepIndex === -1) {
    // No separator before the glob: the pattern is relative to the walk root.
    return { baseDir: "", relativePattern: pattern };
  }

  let baseDir = staticPrefix.slice(0, lastSepIndex);
  const relativePattern = pattern.slice(lastSepIndex + 1);

  // `/*.ts` has an empty prefix but means "the root directory", not "".
  if (baseDir === "" && lastSepIndex === 0) {
    baseDir = "/";
  }

  // `C:` means "the current directory on drive C" (a relative path), so a drive
  // root needs the separator to stay absolute.
  if (process.platform === "win32" && /^[A-Za-z]:$/.test(baseDir)) {
    baseDir = `${baseDir}\\`;
  }

  return { baseDir, relativePattern };
}

/**
 * Rewrite Windows-style separators as `/`.
 *
 * ripgrep reads `\` in a glob as an escape character, so a model writing the
 * path the way Windows shows it (`src\**\*.ts`) silently matches nothing — an
 * empty result, not an error, which is the most expensive way to be wrong. A
 * literal backslash in a file name cannot be expressed through this tool as a
 * result; that is the cheaper loss.
 */
export function normalizeGlobPattern(pattern: string): string {
  return pattern.replace(/\\/g, "/");
}

/**
 * The ripgrep invocation behind the Glob tool.
 *
 * `--files` lists file names instead of searching content; `--sort=modified`
 * orders oldest first (matching Claude Code's Glob); `--no-ignore` and
 * `--hidden` are Claude Code's defaults, so `.gitignore` is not consulted and
 * dot files are visible. Because nothing else filters the walk, VCS metadata has
 * to be excluded explicitly — otherwise `--no-ignore` walks `.git/` like any
 * other directory.
 */
export function buildGlobArgs(pattern: string): string[] {
  const args = [
    "--files",
    "--glob",
    normalizeGlobPattern(pattern),
    "--sort=modified",
    "--no-ignore",
    "--hidden",
  ];

  for (const dir of VCS_DIRECTORIES) {
    args.push("--glob", `!${dir}`);
  }

  return args;
}
