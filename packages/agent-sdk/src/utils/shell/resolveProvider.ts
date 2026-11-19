import { resolveShellPath } from "../shellResolver.js";
import { createBashProvider } from "./bashProvider.js";
import { createPowerShellProvider } from "./powershellProvider.js";
import { getPowerShellPath } from "./powershellDetection.js";
import type { ShellProvider, ShellType } from "./shellProvider.js";

/**
 * Resolve the provider for [kind], or `undefined` when that shell is not
 * available on this machine.
 *
 * Deliberately not memoized yet: `resolveShellPath()` is re-probed on every
 * call today (a Git Bash installed mid-session starts working without a
 * restart), and the PowerShell detection module caches its own lookup — the
 * one thing worth caching there, because it stats every `PATH` entry.
 */
export function getShellProvider(kind: ShellType): ShellProvider | undefined {
  if (kind === "powershell") {
    const shellPath = getPowerShellPath();
    return shellPath ? createPowerShellProvider(shellPath) : undefined;
  }
  const shellPath = resolveShellPath();
  if (!shellPath) return undefined;
  return createBashProvider(shellPath);
}
