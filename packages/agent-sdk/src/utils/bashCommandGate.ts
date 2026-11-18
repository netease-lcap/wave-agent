import type { Container } from "./container.js";
import type { BashCommandGate } from "./markdownParser.js";
import type { PermissionManager } from "../managers/permissionManager.js";
import type { PermissionMode } from "../types/permissions.js";
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
 * No permission callback is passed on purpose: injected commands run while a
 * skill or command is being loaded, before the model is involved, so there is
 * no tool call to attach an interactive prompt to. An unmatched command is
 * therefore denied rather than silently executed (spec
 * `ecosystem/agent-skills` / 注入命令执行前的权限校验).
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
      const decision = await permissionManager.checkPermission(
        permissionManager.createContext(toolName, effectiveMode, undefined, {
          command,
          workdir,
        }),
      );
      return decision.behavior === "allow"
        ? { behavior: "allow" }
        : { behavior: "deny", message: decision.message };
    },
  };
}
