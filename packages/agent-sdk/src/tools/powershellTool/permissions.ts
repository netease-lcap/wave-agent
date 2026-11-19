/**
 * The PowerShell permission decision, in the order the design fixes it.
 *
 *   1. deny rules against the **raw text** — before parsing, so a rule still
 *      fires on a command the parser cannot read;
 *   2. parse (memoized by `psParser`); `valid: false` ⇒ no auto-allow ever, but
 *      first run the deny rules over the text split on statement boundaries;
 *   3. hard denies that no rule can override (`security.ts`, dangerous paths);
 *   4. allow rules, per leaf command — every leaf must be covered;
 *   5. read-only auto-allow: every leaf read-only, nothing written, and every
 *      path argument inside the Safe Zone;
 *   6. ask, with a suggested rule prefix and, where the shape of the command
 *      warrants it, no persistence option.
 *
 * The order is not a style choice. Deny-before-parse is what makes a deny rule
 * trustworthy: the rules a user wrote must hold even for input the parser
 * chokes on, otherwise "make it unparsable" becomes the way around them.
 *
 * Same shape as the bash side, different vocabulary: bash judges
 * `BashStructure` leaves with `READ_ONLY_COMMANDS` / glob rules, PowerShell
 * judges cmdlets with `readOnly.ts` / `PowerShell(…)` rules. Neither borrows the
 * other's conclusions — see the P2 guardrail in `shellCommandAnalysis.ts`.
 */

import { parsePowerShellCommand } from "../../utils/powershellStructure/psParser.js";
import { POWERSHELL_TOOL_NAME } from "../../constants/tools.js";
import {
  resolveToCanonical,
  stripModulePrefix,
} from "../../utils/powershellStructure/canonical.js";
import {
  collectCommands,
  suggestRulePrefixes,
  splitCommandBoundaries,
} from "../../utils/powershellStructure/staticPrefix.js";
import { BLOCK_PERSIST } from "../../utils/powershellStructure/dangerousCmdlets.js";
import type { ParsedCommandElement } from "../../utils/powershellStructure/types.js";
import {
  describeDangerousTarget,
  isDangerousTargetPath,
} from "./pathValidation.js";
import { extractPathArguments, isReadOnlyCmdlet } from "./readOnly.js";
import { inspectPowerShellCommand } from "./security.js";

/** Everything the decision needs from the session, injected so it stays testable. */
export interface PowerShellPermissionRequest {
  command: string;
  /** Used to resolve relative paths for the Safe Zone and the danger checks. */
  workdir?: string;
  /** Allow rules naming this tool, verbatim from the rule sources. */
  allowedRules: string[];
  /** Deny rules naming this tool. */
  deniedRules: string[];
  /** true when [target] resolves inside the session's Safe Zone. */
  isInsideSafeZone(target: string): boolean;
}

export interface PowerShellPermissionResult {
  decision: "allow" | "ask" | "deny";
  /** `read-only`, `allowed-by-rule`, `denied-by-rule`, `unparsable`, … */
  reason: string;
  /** Why, in the user's words — set for `deny`, and for `ask` when it helps. */
  message?: string;
  /** Pre-filled "don't ask again" rule text (`Get-ChildItem`, `git status`). */
  suggestedPrefix?: string;
  /** true when the prompt must not offer to persist a rule. */
  hidePersistentOption?: boolean;
}

/**
 * Glob matching for `PowerShell(Get-ChildItem*)`, the same shape bash rules use:
 * `*` matches everything, everything else is literal, and the comparison is
 * case-insensitive because PowerShell is.
 */
function matchesRulePattern(pattern: string, text: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\?]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "is").test(text);
}

/** The rule's command pattern, or `undefined` when the rule names another tool. */
function rulePattern(toolName: string, rule: string): string | undefined {
  const match = rule.match(/^([\w.:-]+)\((.*)\)$/);
  if (match) return match[1] === toolName ? match[2] : undefined;
  return rule === toolName ? "*" : undefined;
}

/**
 * Text a rule is matched against: what the user typed, and the canonical form
 * of it. Both are needed — `PowerShell(Remove-Item*)` has to cover a command
 * typed as `rm`, and `PowerShell(ls *)` has to keep covering the alias the user
 * wrote themselves.
 */
function matchTexts(leaf: ParsedCommandElement): string[] {
  const canonical = stripModulePrefix(leaf.name);
  const canonicalName = resolveToCanonical(leaf.name);
  const texts = new Set([leaf.text]);
  if (canonical !== leaf.name) {
    texts.add([canonical, ...leaf.args].join(" "));
  }
  texts.add([canonicalName, ...leaf.args].join(" "));
  return [...texts];
}

function matchesAnyRule(
  rules: string[],
  toolName: string,
  leaf: ParsedCommandElement,
): boolean {
  const texts = matchTexts(leaf);
  for (const rule of rules) {
    const pattern = rulePattern(toolName, rule);
    if (pattern === undefined) continue;
    if (texts.some((text) => matchesRulePattern(pattern, text))) return true;
  }
  return false;
}

/**
 * Deny scan used when the command cannot be parsed: the same rules, applied to
 * the text split on `|`, `;`, `&&`, `||`, `{`, `}` and newlines. A fragment has
 * no cmdlet name to canonicalise, so this is a plain text match — deliberately,
 * because there is nothing else trustworthy to match.
 */
function matchesAnyDenyFragment(
  deniedRules: string[],
  toolName: string,
  command: string,
): boolean {
  const fragments = splitCommandBoundaries(command);
  for (const rule of deniedRules) {
    const pattern = rulePattern(toolName, rule);
    if (pattern === undefined) continue;
    if (fragments.some((fragment) => matchesRulePattern(pattern, fragment))) {
      return true;
    }
  }
  return false;
}

/** Does any statement or leaf write to a file? `2>&1` merges, it does not write. */
function isFileRedirection(redirection: {
  isMerging: boolean;
  target: string;
}): boolean {
  return !redirection.isMerging && redirection.target.trim().length > 0;
}

/**
 * Is this leaf a plain read that stays inside the Safe Zone?
 *
 * A leaf that carries a scriptblock or a subexpression is not: the parser has
 * told us there is code in the arguments, and a read-only cmdlet name says
 * nothing about code it was handed.
 */
function isSafeRead(
  leaf: ParsedCommandElement,
  request: PowerShellPermissionRequest,
): boolean {
  if (!isReadOnlyCmdlet(leaf.name)) return false;

  // A subexpression or scriptblock in the arguments is code the parser found;
  // a read-only cmdlet name says nothing about code it was handed.
  const types = leaf.elementTypes ?? [];
  if (types.includes("ScriptBlock") || types.includes("SubExpression")) {
    return false;
  }

  return extractPathArguments(leaf).every((target) =>
    request.isInsideSafeZone(target),
  );
}

/**
 * Decide one PowerShell command.
 *
 * Only `workdir` and `isInsideSafeZone` are used for path questions; the rule
 * lists are matched here rather than by `PermissionManager.matchesRule`
 * because a PowerShell command has to be read as a *sequence of leaves* first,
 * and the manager's matcher works on one command string.
 */
export async function evaluatePowerShellCommand(
  request: PowerShellPermissionRequest,
): Promise<PowerShellPermissionResult> {
  const toolName = POWERSHELL_TOOL_NAME;
  const command = request.command.trim();
  if (!command) {
    return { decision: "ask", reason: "empty-command" };
  }

  // 1. Deny rules against the raw text, before anything can fail to parse.
  for (const rule of request.deniedRules) {
    const pattern = rulePattern(toolName, rule);
    if (pattern !== undefined && matchesRulePattern(pattern, command)) {
      return {
        decision: "deny",
        reason: "denied-by-rule",
        message: `This command is blocked by the rule: ${rule}`,
        hidePersistentOption: true,
      };
    }
  }

  // 2. Parse. A command PowerShell itself cannot parse is never auto-allowed,
  //    but the deny rules still get their chance on the split text.
  const parsed = await parsePowerShellCommand(command);
  if (!parsed.valid) {
    if (matchesAnyDenyFragment(request.deniedRules, toolName, command)) {
      return {
        decision: "deny",
        reason: "denied-by-rule",
        message:
          "This command is blocked by a deny rule (matched on the unparsed text).",
        hidePersistentOption: true,
      };
    }
    return {
      decision: "ask",
      reason: "unparsable",
      message:
        "PowerShell could not parse this command, so it cannot be checked automatically.",
      hidePersistentOption: true,
    };
  }

  const leaves = collectCommands(parsed).filter(
    (leaf) => leaf.elementType === "CommandAst",
  );
  if (leaves.length === 0) {
    // `using module` / `#Requires` parse fine and produce no statements.
    // Nothing was read, so nothing can be allowed.
    return {
      decision: "ask",
      reason: "no-commands",
      message: "This command runs no command that could be checked.",
      hidePersistentOption: true,
    };
  }

  // 3. Hard denies. Rules do not reach these.
  const finding = inspectPowerShellCommand(parsed);
  if (finding?.decision === "deny") {
    return {
      decision: "deny",
      reason: finding.reason,
      message: finding.message,
      hidePersistentOption: true,
    };
  }

  for (const leaf of leaves) {
    for (const target of destructiveTargets(leaf)) {
      if (!isDangerousTargetPath(target, request.workdir)) continue;
      return {
        decision: "deny",
        reason: "dangerous-path",
        message: `Refusing to ${resolveToCanonical(leaf.name)} ${describeDangerousTarget(target, request.workdir)}: this path holds the system or the user's home directory.`,
        hidePersistentOption: true,
      };
    }
  }

  // 4. Allow rules: every leaf has to be covered, so a rule for `Get-ChildItem`
  //    cannot carry a second command along with it. The deny rules get the same
  //    per-leaf treatment — a rule written against `Remove-Item` has to hold for
  //    a command typed as `rm`.
  for (const leaf of leaves) {
    if (matchesAnyRule(request.deniedRules, toolName, leaf)) {
      return {
        decision: "deny",
        reason: "denied-by-rule",
        message: `This command is blocked by a deny rule: ${leaf.text}`,
        hidePersistentOption: true,
      };
    }
  }

  if (
    leaves.every((leaf) => matchesAnyRule(request.allowedRules, toolName, leaf))
  ) {
    return { decision: "allow", reason: "allowed-by-rule" };
  }

  // 5. Read-only auto-allow. Every leaf reads, nothing writes, and every path
  //    stays inside the Safe Zone.
  const writes =
    parsed.statements.some((statement) =>
      statement.redirections.some(isFileRedirection),
    ) ||
    leaves.some((leaf) => (leaf.redirections ?? []).some(isFileRedirection));
  if (!writes && leaves.every((leaf) => isSafeRead(leaf, request))) {
    return { decision: "allow", reason: "read-only" };
  }

  // 6. A person decides. The suggestion is the rule text the dialog pre-fills;
  //    it is absent when no honest prefix exists (see `suggestPrefix`), and the
  //    persistence option is withdrawn when a permanent rule would be a lie.
  const suggested = suggestRulePrefixes(parsed);
  return {
    decision: "ask",
    reason: finding?.reason ?? "needs-approval",
    message: finding?.message,
    suggestedPrefix: leaves.length === 1 ? suggested[0] : undefined,
    hidePersistentOption:
      finding?.hidePersistentOption === true ||
      !isPersistableAsRule(leaves, writes),
  };
}

/**
 * Would a permanent rule be an honest offer?
 *
 * The bash side answers this in `PermissionManager.createContext`: a command in
 * `DANGEROUS_COMMANDS`, a write redirection, or a path outside the Safe Zone
 * hides the option. The PowerShell equivalents are a cmdlet in
 * `BLOCK_PERSIST` — destructive and irreversible — and a write redirection.
 * Saying yes to `Set-Content` once is fine; a rule that keeps saying yes to it
 * forever is what this refuses to offer.
 *
 * `NO_PREFIX_SUGGEST` is deliberately **not** consulted here. A cmdlet on that
 * list (`Invoke-Expression`, `Start-Process`, `ForEach-Object`) only loses the
 * wildcard pre-fill: the rule then written is the exact command text, which
 * pins the code, the target and the scriptblock the person just read. CC draws
 * the line in the same place, which is why its `Invoke-Expression` prompt still
 * has "don't ask again".
 *
 * Asking stays useful without the option — the person is answering for this one
 * command, not for a rule they cannot judge from one example.
 */
function isPersistableAsRule(
  leaves: ParsedCommandElement[],
  writes: boolean,
): boolean {
  if (writes) return false;
  return leaves.every(
    (leaf) => !BLOCK_PERSIST.has(resolveToCanonical(leaf.name).toLowerCase()),
  );
}

/** Cmdlets whose path arguments a destructive command acts on. */
const WRITE_TARGET_CMDLETS: ReadonlySet<string> = new Set([
  "remove-item",
  "clear-content",
  "set-content",
  "add-content",
  "out-file",
  "move-item",
  "rename-item",
]);

/** Absolute-looking path arguments of a destructive command. */
function destructiveTargets(leaf: ParsedCommandElement): string[] {
  if (!WRITE_TARGET_CMDLETS.has(resolveToCanonical(leaf.name).toLowerCase())) {
    return [];
  }
  return leaf.args
    .map((arg) => {
      // `-Path:C:\` binds its value in the same element.
      const boundIndex = arg.indexOf(":");
      return arg.startsWith("-") && boundIndex > 0
        ? arg.slice(boundIndex + 1)
        : arg;
    })
    .filter((arg) => !arg.startsWith("-"));
}
