import { createRequire } from "node:module";

/**
 * Path to the ripgrep binary, provided by the @vscode/ripgrep dependency.
 *
 * Resolved through a runtime require rather than a top-level import: the
 * wrapper resolves the platform-specific binary package
 * (`@vscode/ripgrep-<platform>-<arch>`) while its module body evaluates and
 * throws when that package is absent. A top-level import would therefore take
 * down any host that loads the SDK barrel without the platform package — the
 * desktop main process and the IDE extension hosts ship no such package and run
 * grep in the CLI child process instead. Undefined means grep is unavailable
 * (the Grep tool reports it, file search throws its own error).
 */
export const rgPath: string | undefined = (() => {
  try {
    return createRequire(import.meta.url)("@vscode/ripgrep").rgPath as string;
  } catch {
    return undefined;
  }
})();
