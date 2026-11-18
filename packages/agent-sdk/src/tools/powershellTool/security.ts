/**
 * Constructs in a PowerShell command that the *text* already condemns,
 * independently of which cmdlet runs.
 *
 * Three outcomes, and the difference between them is deliberate:
 *
 * - **deny** — nothing legitimate is being asked for. `-EncodedCommand` exists
 *   to make a command unreadable to the thing that is supposed to read it, and
 *   a download piped straight into `Invoke-Expression` is the canonical
 *   "run this stranger's code" shape. Rules do not override these.
 * - **ask (scriptblock / spawn)** — the user may well mean it: `Add-Type`,
 *   `Start-Process`, `New-PSSession`, or a `ScriptBlock` handed to a cmdlet that
 *   executes it. These get a prompt and no persistence option, because the
 *   *arguments* are what make them dangerous and the arguments change.
 * - **ask (obfuscation)** — a parameter abbreviation (`-enc`, `-EncodedComm`)
 *   that PowerShell accepts and a reader does not recognise.
 *
 * Not ported from CC: `powershellSecurity.ts`'s validators for the allowlisted
 * cmdlets. wave's bash side has no argument-level analysis to mirror, and being
 * stricter than bash here would only add prompts for commands that bash
 * auto-allows. What is ported is the small set of shapes where the *text*
 * itself is the hazard, which bash also refuses to auto-allow.
 */

import { resolveToCanonical } from "../../utils/powershellStructure/canonical.js";
import { DANGEROUS_SCRIPT_BLOCK_CMDLETS } from "../../utils/powershellStructure/dangerousCmdlets.js";
import type {
  ParsedCommandElement,
  ParsedPowerShellCommand,
} from "../../utils/powershellStructure/types.js";

/** What the text alone says about a command. */
export interface PowerShellSecurityFinding {
  decision: "deny" | "ask";
  /** Short machine-readable id (`encoded-command`, `download-and-execute`, …). */
  reason: string;
  /** One sentence for the user. */
  message: string;
  /** true when the prompt must not offer "don't ask again". */
  hidePersistentOption: boolean;
}

/** Cmdlets that run a string as code. */
const EXECUTION_CMDLETS: ReadonlySet<string> = new Set(["invoke-expression"]);

/** Cmdlets whose output can be a script fetched from somewhere else. */
const DOWNLOAD_CMDLETS: ReadonlySet<string> = new Set([
  "invoke-webrequest",
  "invoke-restmethod",
  "start-bitstransfer",
]);

/** Cmdlets that hand execution to something else entirely. */
const SPAWNING_CMDLETS: ReadonlySet<string> = new Set([
  "add-type",
  "start-process",
  "new-pssession",
  "enter-pssession",
  "invoke-command",
]);

/**
 * Parameter names whose abbreviation is itself suspicious (see below).
 * `-EncodedCommand` is the one that matters: PowerShell accepts `-enc` and
 * `-EncodedComm` for it, so a reader — and a deny rule written against the long
 * form — sees only the short one.
 */
const OBFUSCATABLE_PARAMETERS = ["encodedcommand"];

/**
 * Is [flag] an accepted abbreviation of [parameter]? PowerShell resolves
 * `-enc`, `-EncodedComm` and `-EncodedCommand` to the same parameter, so a
 * reader (and a deny rule written against the long form) sees only the short
 * one. Three characters is the shortest unambiguous abbreviation PowerShell
 * itself accepts.
 */
function isAbbreviationOf(flag: string, parameter: string): boolean {
  if (!flag.startsWith("-")) return false;
  // `-EncodedCommand:xyz` carries its value in the same element.
  const name = flag.slice(1).split(":")[0]!.toLowerCase();
  return name.length >= 3 && parameter.startsWith(name);
}

function canonicalName(leaf: ParsedCommandElement): string {
  return resolveToCanonical(leaf.name).toLowerCase();
}

/** Every command in the parse result, pipeline stages and nested commands. */
function allCommands(parsed: ParsedPowerShellCommand): ParsedCommandElement[] {
  const commands: ParsedCommandElement[] = [];
  for (const statement of parsed.statements) {
    commands.push(...statement.commands);
    if (statement.nestedCommands) commands.push(...statement.nestedCommands);
  }
  return commands;
}

/** Is any element of this command a scriptblock (`{ … }`)? */
function hasScriptBlockArgument(leaf: ParsedCommandElement): boolean {
  return (leaf.elementTypes ?? []).includes("ScriptBlock");
}

/**
 * Inspect a parsed command. Returns the first finding that applies, or
 * `undefined` when the text says nothing conclusive — which is *not* a
 * statement that the command is safe, only that this module has no opinion and
 * the caller's ordinary checks should decide.
 */
export function inspectPowerShellCommand(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityFinding | undefined {
  const commands = allCommands(parsed);

  // 1. An encoded command: the whole point is that nothing here can be read.
  for (const leaf of commands) {
    for (const arg of leaf.args) {
      if (OBFUSCATABLE_PARAMETERS.some((name) => isAbbreviationOf(arg, name))) {
        return {
          decision: "deny",
          reason: "encoded-command",
          message:
            "This command passes an encoded or hidden parameter, so what it will actually run cannot be read. Run the readable form instead.",
          hidePersistentOption: true,
        };
      }
    }
  }

  // 2. Download straight into execution. `iwr … | iex` and
  //    `iwr … -OutFile x; & x` are the two halves of the same attack, so the
  //    check is per statement: a download and an execution in one statement is
  //    already the pattern.
  for (const statement of parsed.statements) {
    const statementCommands = [
      ...statement.commands,
      ...(statement.nestedCommands ?? []),
    ];
    const downloads = statementCommands.filter((leaf) =>
      DOWNLOAD_CMDLETS.has(canonicalName(leaf)),
    );
    if (downloads.length === 0) continue;

    const executes = statementCommands.some((leaf) => {
      const canonical = canonicalName(leaf);
      return (
        EXECUTION_CMDLETS.has(canonical) ||
        SPAWNING_CMDLETS.has(canonical) ||
        // `& { iwr … }` — a bare invocation of the download's own output.
        leaf.name.startsWith("&")
      );
    });

    if (executes) {
      return {
        decision: "deny",
        reason: "download-and-execute",
        message:
          "This command downloads content and executes it in the same statement. Download it to a file, inspect it, and run it as a separate step.",
        hidePersistentOption: true,
      };
    }
  }

  // 3. Execution, spawning and friend: allowed to run, but only after a person
  //    looked at the arguments, and never via a rule that would approve the
  //    arguments of a future call. `New-Object` is here only in its COM form —
  //    `New-Object System.Collections.ArrayList` is ordinary code and gets the
  //    ordinary treatment.
  for (const leaf of commands) {
    const canonical = canonicalName(leaf);
    const isScriptBlockCmdlet = (
      DANGEROUS_SCRIPT_BLOCK_CMDLETS as readonly string[]
    ).includes(canonical);
    const isComObject =
      canonical === "new-object" &&
      leaf.args.some((arg) => isAbbreviationOf(arg, "comobject"));

    if (
      EXECUTION_CMDLETS.has(canonical) ||
      SPAWNING_CMDLETS.has(canonical) ||
      isComObject ||
      (isScriptBlockCmdlet && hasScriptBlockArgument(leaf))
    ) {
      return {
        decision: "ask",
        // `Invoke-Expression` is also a scriptblock cmdlet; name the more
        // specific hazard — the string it was handed — rather than the family.
        reason:
          isScriptBlockCmdlet && !EXECUTION_CMDLETS.has(canonical)
            ? "script-block"
            : "dynamic-execution",
        message: `${leaf.name} runs code that this session cannot inspect in advance.`,
        hidePersistentOption: true,
      };
    }
  }

  return undefined;
}
