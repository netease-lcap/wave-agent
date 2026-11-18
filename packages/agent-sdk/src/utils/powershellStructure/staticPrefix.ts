/**
 * "Yes, and don't ask again for: ___" — the rule text the permission dialog
 * pre-fills for a PowerShell command.
 *
 * The bash side has one such extractor (`getSmartPrefix`, `utils/bashParser.ts`)
 * that knows how deep each tool's subcommand sits: `git status` is a rule,
 * `git` alone is not (it would auto-allow `git push --force`). External
 * programs are the same programs here, so their prefixes come from that same
 * table (`git status`, `npm run test`) rather than from a second one that
 * could disagree.
 *
 * Cmdlets need no depth at all: `Verb-Noun` *is* the granularity. `Get-Process`
 * is suggested as `Get-Process`, never as something shorter, and the cmdlets
 * whose name alone means "anything goes" (`Remove-Item`, `Invoke-Expression`)
 * are refused by `NEVER_SUGGEST` instead.
 *
 * Suggested prefixes are always canonical: `ls` suggests `Get-ChildItem`.
 * A rule is persisted and matched later, and a canonical name cannot be
 * re-pointed by `Set-Alias ls rm` between the prompt and the next invocation.
 *
 * **Command boundaries.** PowerShell pipelines hand objects to the next stage
 * instead of text, so `… | bash`-style hazards do not translate: every stage
 * is a real command invocation and gets its own rule. What a caller still
 * needs is the boundary set — `|`, `||`, `;`, `&&`, `(`, `)`, `{`, `}`,
 * newline, and the backtick line continuation — which
 * `splitCommandBoundaries` provides for the case where the parser could not
 * produce statements at all (P3c's deny scan on a parse failure).
 */

import { getSmartPrefix } from "../bashParser.js";
import {
  classifyCommandName,
  resolveToCanonical,
  stripModulePrefix,
} from "./canonical.js";
import { NEVER_SUGGEST } from "./dangerousCmdlets.js";
import type { ParsedCommandElement, ParsedPowerShellCommand } from "./types.js";

/**
 * Element kinds whose value is known before the command runs. Anything else
 * (`$ref`, `$(…)`, `{ … }`, `"$msg"`) would end up inside the rule text, which
 * makes the rule either unmatchable or a pattern the user did not read.
 */
const STATIC_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  "StringConstant",
  "Parameter",
]);

/**
 * Every command in a parse result: pipeline elements of `PipelineAst`
 * statements plus the commands nested inside control flow, function bodies and
 * `param()` defaults.
 *
 * Both lists are needed. `if (Test-Path x) { Remove-Item x }` has no pipeline
 * commands at all, and an empty `commands` array is not evidence of anything.
 */
export function collectCommands(
  parsed: ParsedPowerShellCommand,
): ParsedCommandElement[] {
  const commands: ParsedCommandElement[] = [];
  for (const statement of parsed.statements) {
    commands.push(...statement.commands);
    if (statement.nestedCommands) commands.push(...statement.nestedCommands);
  }
  return commands;
}

/**
 * Rule prefix for one command, or `null` when no honest prefix exists.
 *
 * `null` is the common answer and not a failure: every caller turns it into
 * "show the prompt without a pre-filled rule", which is exactly what should
 * happen for a path-like invocation or a command whose arguments are dynamic.
 */
export function suggestPrefix(command: ParsedCommandElement): string | null {
  if (command.elementType !== "CommandAst") return null;

  const name = command.name;
  if (!name) return null;

  // Path-like or extension-bearing name (`.\build.ps1`, `C:\tools\x.exe`):
  // PowerShell runs that file, and a rule keyed on a path is either dead
  // (the path changes) or over-specific (it approves exactly that binary
  // forever). Same reasoning as the bash side refusing to suggest `./script`.
  if (classifyCommandName(stripModulePrefix(name)) === "application") {
    return null;
  }

  const canonical = resolveToCanonical(name);

  if (classifyCommandName(canonical) === "cmdlet") {
    return NEVER_SUGGEST.has(canonical.toLowerCase()) ? null : canonical;
  }

  // An external program. Its arguments have to be literals for the prefix to
  // mean anything, and the name must be literal too: `& $cmd status` has no
  // static root.
  if (command.elementTypes) {
    for (const type of command.elementTypes) {
      if (!STATIC_ELEMENT_TYPES.has(type)) return null;
    }
  }

  // Same oracle the bash side consults, on the same argv. `git -C /repo status`
  // still lands on `git status` because the table knows `-C` takes a value.
  return getSmartPrefix([canonical, ...command.args].join(" "));
}

/**
 * Prefixes for a whole command, deduplicated case-insensitively (PowerShell
 * treats `Get-ChildItem` and `get-childitem` as one command).
 *
 * Deliberately **no** collapse of sibling prefixes: `git add` + `git commit`
 * would share the longest common prefix `git`, and `PowerShell(git:*)` is the
 * over-broad rule this module exists to avoid. Two narrower rules are surfaced
 * instead; the dialog lets the user edit them down. An unparsed command
 * returns `[]` — there is nothing to suggest from a parse that failed.
 */
export function suggestRulePrefixes(parsed: ParsedPowerShellCommand): string[] {
  if (!parsed.valid) return [];

  const prefixes: string[] = [];
  const seen = new Set<string>();
  for (const command of collectCommands(parsed)) {
    const prefix = suggestPrefix(command);
    if (!prefix) continue;
    const key = prefix.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    prefixes.push(prefix);
  }
  return prefixes;
}

/**
 * Split command text on PowerShell's statement boundaries — `|`, `||`, `;`,
 * `&&`, `(`, `)`, `{`, `}`, newline — honouring single and double quotes and
 * folding backtick line continuations into one command.
 *
 * This is the *text* path, for callers that have no parse result: P3c's deny
 * scan when `parsePowerShellCommand` came back `valid: false`. Quotes are
 * respected because the text at that point is exactly what PowerShell will
 * re-read; the split is a best-effort approximation of the statement list, and
 * its only job is to let a deny rule match a fragment of an unparsable command.
 */
export function splitCommandBoundaries(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) parts.push(trimmed);
    current = "";
  };

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;

    if (quote === "'") {
      // Single-quoted text is literal — a backtick or a separator inside it is
      // just a character. `''` closes and immediately reopens, which leaves
      // the following separators quoted, which is what PowerShell does too.
      if (char === "'") quote = null;
      current += char;
      continue;
    }

    if (char === "`") {
      const next = command[i + 1];
      if (next === "\n" || next === "\r") {
        // Line continuation: the command continues on the next line, so a
        // newline here is not a statement boundary.
        i += next === "\r" && command[i + 2] === "\n" ? 2 : 1;
      } else if (next !== undefined) {
        // Escaped character (`` `" ``, `` `n ``, `` `` ``): keep both, so a
        // quote cannot be closed by an escaped one.
        current += char + next;
        i++;
      } else {
        current += char;
      }
      continue;
    }

    if (quote === '"') {
      if (char === '"') quote = null;
      current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === "|") {
      flush();
      if (command[i + 1] === "|") i++;
      continue;
    }

    if (char === "&") {
      if (command[i + 1] === "&") {
        flush();
        i++;
      } else {
        // Bare `&` is the call operator, not a boundary.
        current += char;
      }
      continue;
    }

    if (
      char === ";" ||
      char === "(" ||
      char === ")" ||
      char === "{" ||
      char === "}" ||
      char === "\n" ||
      char === "\r"
    ) {
      flush();
      if (char === "\r" && command[i + 1] === "\n") i++;
      continue;
    }

    current += char;
  }

  flush();
  return parts;
}
