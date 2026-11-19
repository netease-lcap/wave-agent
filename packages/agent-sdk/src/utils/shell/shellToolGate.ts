/**
 * Which shell this session has, and whether the PowerShell tool belongs in its
 * tool set.
 *
 * Two consumers, one decision: the tool *registry* asks "should `PowerShell` be
 * registered" and everything that routes a command asks `resolveShellKind()`
 * "which shell do I drive". Both read the same three inputs, so a session can
 * never see the tool without being able to run it (or run it without being
 * able to see it) — the failure mode that made this module a separate file.
 *
 * Semantics (design §2.4), in order:
 *
 *   1. not Windows        → off. A POSIX box runs bash; `pwsh` there is exotic
 *                           enough that its absence of tooling is not a bug.
 *   2. env truthy         → on  (`1` `true` `yes` `on`, any case, trimmed)
 *   3. env falsy          → off (`0` `false` `no` `off`) — a hard off even when
 *                           there is no Git Bash: that combination is "neither
 *                           shell", and the Bash tool says so.
 *   4. anything else      → on when there is no Git Bash, off when there is.
 *
 * Step 4 is the one branch Claude Code does not have (its gate is env-only).
 * It is what makes a machine without Git for Windows usable at all. The price
 * is that a typo (`=maybe`) reads as "unset" rather than "off" — recorded in
 * the case matrix rather than smoothed over by guessing at near-misses.
 *
 * The env value is resolved settings → process env, like every other
 * tool-visibility switch (`isTaskToolsEnabled`, `WAVE_ENABLE_TASK_TOOLS`): the
 * people who want PowerShell *despite* having Git Bash edit settings.json, not
 * the system environment (which on the desktop/IDE hosts means editing a
 * shortcut and restarting). `WAVE_SHELL` / `WAVE_GIT_BASH_PATH` are OS-env-only
 * by contrast because they decide *path discovery*, which is fixed at process
 * start.
 */

import { loadMergedWaveConfig } from "../../services/configurationService.js";
import { isBashAvailable } from "../bashAvailability.js";
import { resolveShellPath } from "../shellResolver.js";
import { getPowerShellPath } from "./powershellDetection.js";

/** Opt-in / opt-out switch for the PowerShell tool. */
export const POWERSHELL_TOOL_ENV_VAR = "WAVE_USE_POWERSHELL_TOOL";

/** Every input the decision needs, injected so the rules stay pure. */
export interface ShellToolGateInput {
  platform: NodeJS.Platform;
  /** Raw `WAVE_USE_POWERSHELL_TOOL` value, already resolved settings → env. */
  envValue: string | undefined;
  hasGitBash: boolean;
}

/** The three answers: which shell runs this session's commands. */
export type ShellKindChoice = "bash" | "powershell" | "none";

const TRUTHY = ["1", "true", "yes", "on"];
const FALSY = ["0", "false", "no", "off"];

/**
 * `true`/`false` for a value that clearly says so, `undefined` for unset,
 * empty, or anything unrecognised. Shared vocabulary with Claude Code's
 * `isEnvTruthy` / `isEnvDefinedFalsy` so `=yes` is not read as "unset".
 */
function parseFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (TRUTHY.includes(normalized)) return true;
  if (FALSY.includes(normalized)) return false;
  return undefined;
}

/**
 * Whether the PowerShell tool is part of this session's tool set.
 *
 * This is the only place `WAVE_USE_POWERSHELL_TOOL` is read: a second reader
 * would be a way for the registry and the executor to disagree.
 */
export function isPowerShellToolEnabled(input: ShellToolGateInput): boolean {
  if (input.platform !== "win32") return false;
  return parseFlag(input.envValue) ?? !input.hasGitBash;
}

/**
 * Which shell a command from this session should run in.
 *
 * `"none"` is a real answer, not an error: the caller reports it as a tool-level
 * failure ("install Git for Windows, or set `WAVE_USE_POWERSHELL_TOOL=1`").
 * A library must not `process.exit` because a probe came back empty — the
 * desktop host would lose the whole app, not just the tool.
 */
export function resolveShellKind(input: ShellToolGateInput): ShellKindChoice {
  if (isPowerShellToolEnabled(input)) return "powershell";
  return input.hasGitBash ? "bash" : "none";
}

/**
 * Gather the inputs: settings `env` (wins) → process env, Git Bash discovery,
 * and the platform. Impure by design — everything above it is a pure function
 * of these three values.
 *
 * A failing settings read falls through to the process env rather than
 * propagating: this runs on every tool-registry rebuild, including live
 * reloads triggered by an unrelated settings edit.
 */
export function collectShellToolGateInput(
  workdir?: string,
): ShellToolGateInput {
  let fromSettings: string | undefined;
  if (workdir) {
    try {
      fromSettings =
        loadMergedWaveConfig(workdir)?.env?.[POWERSHELL_TOOL_ENV_VAR];
    } catch {
      // Fall through to the process env and then the default rule.
    }
  }
  return {
    platform: process.platform,
    envValue: fromSettings ?? process.env[POWERSHELL_TOOL_ENV_VAR],
    hasGitBash: isBashAvailable(),
  };
}

/**
 * The binary that will actually run a command for this session, or an
 * actionable message why there is none.
 *
 * Callers that must spawn a shell themselves — hooks, the telemetry helper,
 * skill-injected `!`cmd`` blocks — used to pick a shell on their own, on
 * Windows with a `cmd.exe` fallback when Git Bash was missing. That fallback is
 * what this function removes: it was a silent downgrade (hooks are written in
 * bash syntax; `cmd /c` does not even strip quotes after the first token, issue
 * #1773) and it let a session be judged in one shell and executed in another.
 * Claude Code's Bash-hook branch throws in the same situation and never reaches
 * for cmd.exe (`src/utils/hooks.ts:976`).
 *
 * The two failure modes stay distinct on purpose — "install Git for Windows"
 * and "the PowerShell tool is on but PowerShell is not on PATH" have different
 * fixes, and one message for both would send half the users to the wrong one.
 */
export type SessionShell =
  | { kind: "bash" | "powershell"; shellPath: string }
  | { problem: string };

/** Neither shell: no Git Bash, and the PowerShell tool is off or impossible. */
export const MSG_NO_SHELL =
  "No shell is available to run this command: Git Bash was not found and the PowerShell tool is off. " +
  "Install Git for Windows (https://git-scm.com/downloads/win), or set " +
  `"env": { "${POWERSHELL_TOOL_ENV_VAR}": "1" } in settings.json.`;

/** The gate selected PowerShell, but no binary is on PATH. */
export const MSG_POWERSHELL_MISSING =
  "The PowerShell tool is enabled but no PowerShell executable (pwsh or powershell) was found on PATH. " +
  "Install PowerShell 7, or set " +
  `"env": { "${POWERSHELL_TOOL_ENV_VAR}": "0" } in settings.json to use Git Bash.`;

/**
 * Resolve the session's shell binary. `workdir` decides which project
 * `settings.json` is read, so a per-project `WAVE_USE_POWERSHELL_TOOL` is
 * honoured here exactly as it is by the tool registry.
 */
export function resolveSessionShell(workdir?: string): SessionShell {
  const kind = resolveShellKind(collectShellToolGateInput(workdir));
  if (kind === "powershell") {
    const shellPath = getPowerShellPath();
    return shellPath
      ? { kind, shellPath }
      : { problem: MSG_POWERSHELL_MISSING };
  }
  if (kind === "bash") {
    const shellPath = resolveShellPath();
    return shellPath ? { kind, shellPath } : { problem: MSG_NO_SHELL };
  }
  return { problem: MSG_NO_SHELL };
}
