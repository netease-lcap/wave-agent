import { resolveShellPath } from "../shellResolver.js";
import { createBashProvider } from "./bashProvider.js";
import type { ShellProvider, ShellType } from "./shellProvider.js";

/**
 * Resolve the provider for [kind], or `undefined` when that shell is not
 * available on this machine.
 *
 * Deliberately not memoized yet: `resolveShellPath()` is re-probed on every
 * call today (a Git Bash installed mid-session starts working without a
 * restart), and the cache belongs with the PowerShell detection module, which
 * spawns a process to learn its edition.
 */
export function getShellProvider(kind: ShellType): ShellProvider | undefined {
  if (kind === "powershell") return undefined;
  const shellPath = resolveShellPath();
  if (!shellPath) return undefined;
  return createBashProvider(shellPath);
}
