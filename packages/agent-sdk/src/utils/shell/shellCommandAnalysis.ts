/**
 * The permission layer's view of a shell command, per shell kind.
 *
 * Everything that judges a command — the structure-aware parser, the rule
 * matcher, the persisted-rule expander — has to agree on how a command line is
 * cut into pieces. That cutting is the only part that differs between shells,
 * so it sits behind this one function instead of at each call site: adding a
 * shell means adding a branch here, not editing the permission manager.
 */

import { parseBashStructure } from "../bashStructure/index.js";
import type {
  BashStructureOk,
  BashUnsupportedReason,
} from "../bashStructure/types.js";
import type { ShellType } from "./shellProvider.js";

/**
 * Outcome of cutting a command line into leaf commands.
 *
 * `no-parser` means the shell has no parser yet (PowerShell before its parser
 * lands) and carries the same consequence as bash's own `unsupported` reasons:
 * the caller must ask instead of judging the command.
 */
export type ShellCommandAnalysis =
  | BashStructureOk
  | {
      status: "unsupported";
      reason: BashUnsupportedReason | "no-parser";
      message?: string;
    };

/**
 * Cut [command] into the leaf commands a rule is matched against.
 *
 * bash: the structure-aware parser, which fails closed on anything it cannot
 * statically reduce (heredocs, eval, arithmetic, …).
 *
 * powershell: fail closed for now. This is a guardrail, not a placeholder —
 * without it a PowerShell command would be split with bash syntax and could be
 * auto-allowed by `Bash(…)`-shaped reasoning that does not apply to it.
 */
export function analyzeShellCommand(
  kind: ShellType,
  command: string,
): ShellCommandAnalysis {
  if (kind === "bash") return parseBashStructure(command);
  return {
    status: "unsupported",
    reason: "no-parser",
    message: `no ${kind} command parser yet`,
  };
}
