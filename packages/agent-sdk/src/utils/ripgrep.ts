import { createRequire } from "node:module";

/**
 * Lazy access to the optional `@vscode/ripgrep` search dependency.
 *
 * ## Why a runtime require, and why not at module-evaluation time
 *
 * The wrapper resolves the platform-specific binary package
 * (`@vscode/ripgrep-<platform>-<arch>`) while its module body evaluates and
 * throws when that package is absent. A top-level import would therefore take
 * down any host that loads the SDK barrel without the platform package — the
 * desktop main process and the IDE extension hosts ship no such package and run
 * grep in the CLI child process instead.
 *
 * Resolution is also *re-attempted* rather than frozen at module-evaluation
 * time: the CLI installs this dependency itself, after its own module graph has
 * been evaluated (see `utils/runtimeDeps.ts`), so an eager value would pin "grep
 * is missing" for the whole first process. The installer calls
 * {@link resetRipgrep} once the binary is on disk.
 */
let cached: string | undefined;
let resolutionAttempted = false;

/**
 * Resolve the rg binary path through [requireFn], or `undefined` when it is not
 * installed. `requireFn` is injectable so the installer can verify an install
 * from the directory the CLI will actually load it from, and so tests can
 * exercise both outcomes without the real package.
 */
export function resolveRipgrep(requireFn: NodeRequire): string | undefined {
  try {
    const loaded = requireFn("@vscode/ripgrep") as { rgPath?: unknown };
    return typeof loaded?.rgPath === "string" ? loaded.rgPath : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Path to the ripgrep binary, or `undefined` when grep is unavailable (the Grep
 * tool reports it, file search throws its own error). Memoised once resolved —
 * callers on a hot path pay a string check after that.
 */
export function getRgPath(): string | undefined {
  if (!resolutionAttempted) {
    resolutionAttempted = true;
    cached = resolveRipgrep(createRequire(import.meta.url));
  }
  return cached;
}

/**
 * Forget the memoised path so the next {@link getRgPath} resolves again. Called
 * by the runtime-dependency installer once rg is on disk — without it a process
 * that asked for rg *before* the download finished would report grep as missing
 * for its whole lifetime. Also used by tests.
 */
export function resetRipgrep(): void {
  cached = undefined;
  resolutionAttempted = false;
}
