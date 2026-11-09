import { createRequire } from "node:module";
import { isPackageOnDisk } from "./packageOnDisk.js";

/**
 * Lazy access to the optional `wave-search-tools` dependency — the ugrep and
 * bfs binaries that shadow `grep` / `find` inside the Bash tool's shell.
 *
 * Same shape, and the same two hazards, as `utils/ripgrep.ts`:
 *
 * - The package is an *optional* dependency that most hosts do not ship (the
 *   IDE extensions and the desktop app run grep in the CLI child process), so a
 *   top-level import would drag a resolver into hosts that never use it.
 * - The CLI installs it itself, after its own module graph has been evaluated
 *   (see `utils/runtimeDeps.ts`), so resolution must be *re-attempted* rather
 *   than frozen at module-evaluation time. `onInstalled` calls
 *   {@link resetSearchTools} once the binaries are on disk.
 *
 * A missing package is not an error: the shell integration falls back to the
 * system `grep` / `find` (spec `core/bash-tools.md`, scenario 7).
 */

/** The binaries this platform ships, keyed by the command they back. */
export interface SearchToolPaths {
  /** ugrep — shadows `grep` on every platform, Windows included. */
  ugrep?: string;
  /**
   * bfs — shadows `find` on macOS / Linux / WSL. Never Windows: the package
   * ships ugrep only there, because msys `find` already is GNU find.
   */
  bfs?: string;
}

const PACKAGE = "wave-search-tools";

let cached: SearchToolPaths | undefined;
let resolutionAttempted = false;

/**
 * Resolve the binary paths through [requireFn], or `undefined` when the
 * platform package is not installed.
 *
 * [requireFn] is injectable for the same two reasons as `resolveRipgrep`: the
 * installer verifies an install from the directory the CLI will actually load
 * from, and tests exercise both outcomes without the real package.
 *
 * The existence probe runs before the require — see {@link isPackageOnDisk}
 * for why asking Node to resolve an absent package poisons that path for the
 * rest of the process.
 *
 * `resolveSearchTools()` takes no argument: since 0.3.0 the package resolves its
 * own platform package from its own directory, the way `@vscode/ripgrep` does,
 * so pnpm's nested layout (`.pnpm/wave-search-tools@<v>/node_modules/...`) works
 * as well as a flat npm install. [requireFn] therefore only has to reach the
 * wrapper itself.
 */
export function resolveSearchTools(
  requireFn: NodeRequire,
): SearchToolPaths | undefined {
  if (!isPackageOnDisk(requireFn, PACKAGE)) return undefined;
  try {
    const loaded = requireFn(PACKAGE) as {
      resolveSearchTools?: () => SearchToolPaths | null;
    };
    if (typeof loaded?.resolveSearchTools !== "function") return undefined;
    return loaded.resolveSearchTools() ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Binary paths for the search tools, or `undefined` when they are unavailable
 * (no package for this platform, download failed, private deployment without
 * them). Memoised once resolved — the Bash tool asks on every call.
 */
export function getSearchTools(): SearchToolPaths | undefined {
  if (!resolutionAttempted) {
    resolutionAttempted = true;
    cached = resolveSearchTools(createRequire(import.meta.url));
  }
  return cached;
}

/**
 * Forget the memoised paths so the next {@link getSearchTools} resolves again.
 * Called by the runtime-dependency installer once the binaries are on disk, and
 * by tests.
 */
export function resetSearchTools(): void {
  cached = undefined;
  resolutionAttempted = false;
}
