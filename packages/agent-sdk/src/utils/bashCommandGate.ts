import type { Container } from "./container.js";
import type { BashCommandGate } from "./markdownParser.js";
import type { PermissionManager } from "../managers/permissionManager.js";
import type {
  PermissionCallback,
  PermissionMode,
} from "../types/permissions.js";
import { BASH_TOOL_NAME, POWERSHELL_TOOL_NAME } from "../constants/tools.js";
import {
  collectShellToolGateInput,
  resolveShellKind,
} from "./shell/shellToolGate.js";

/**
 * Build the gate that judges commands injected from skill / custom-command
 * bodies (`!`cmd`` and ```! blocks```).
 *
 * It delegates to the same `PermissionManager` instance, the same effective
 * permission mode and the same rule sources the shell tool uses, so both paths
 * judge by one rule set instead of two that would drift. The tool *name* is the
 * session's own shell tool, not always `Bash`: rules live in per-tool
 * namespaces (`Bash(cmd:*)` vs `PowerShell(cmd:*)`), and judging a PowerShell
 * session's command against the Bash namespace would deny it for the wrong
 * reason — or, worse, let a `Bash(...)` allow rule authorize a command that the
 * PowerShell tool would then run with different parsing.
 *
 * The host's `CanUseToolCallback` is passed through, so a command no rule covers
 * reaches the person who is waiting — the same card the shell tool would raise.
 * Without it `PermissionManager` has nobody to ask and answers itself with a
 * deny ("No permission callback configured"), which is what used to make a
 * skill's own injected commands fail outright in a session whose rules name the
 * other shell (`Bash(...)` rules are silently inert under PowerShell, exactly as
 * they are in Claude Code). Claude Code asks in that situation; so does wave
 * now. A deny the person actually answered (or a `dontAsk` mode) still aborts
 * the injection.
 *
 * Returns `undefined` when no permission manager is registered (bare SDK usage
 * without the container wired), which leaves injected commands ungated exactly
 * as before.
 */
export function createBashCommandGate(
  container: Container,
): BashCommandGate | undefined {
  if (!container.has("PermissionManager")) return undefined;

  const permissionManager =
    container.get<PermissionManager>("PermissionManager");
  if (!permissionManager) return undefined;

  const sessionMode = container.has("PermissionMode")
    ? container.get<PermissionMode>("PermissionMode")
    : undefined;
  const effectiveMode = permissionManager.getCurrentEffectiveMode(sessionMode);

  return {
    check: async (command, workdir) => {
      // Resolved per call, like the execution side: the session can switch shell
      // preference between two injected commands only by restarting, but the
      // workdir a settings.json in another project would be read from can
      // change, so this must not be hoisted out of `check`.
      const toolName =
        resolveShellKind(collectShellToolGateInput(workdir)) === "powershell"
          ? POWERSHELL_TOOL_NAME
          : BASH_TOOL_NAME;
      // Read per call: the host installs the callback after the agent exists.
      const canUseToolCallback = container.has("CanUseToolCallback")
        ? container.get<PermissionCallback>("CanUseToolCallback")
        : undefined;
      const decision = await permissionManager.checkPermission(
        permissionManager.createContext(
          toolName,
          effectiveMode,
          canUseToolCallback,
          {
            command,
            workdir,
          },
        ),
      );
      return decision.behavior === "allow"
        ? { behavior: "allow" }
        : { behavior: "deny", message: decision.message };
    },
  };
}
