/**
 * Which PowerShell commands only read.
 *
 * The bash side has `READ_ONLY_COMMANDS` (`utils/bashParser.ts`) and the
 * permission layer auto-allows a command whose every part is in it, provided
 * nothing writes and the paths it names are inside the Safe Zone. This is the
 * PowerShell list with the same job and the same limits — it is a *name* list,
 * not an argument analysis: a cmdlet here must be one that cannot write, spawn
 * or execute, whatever it is handed.
 *
 * Deliberately absent:
 * - `ForEach-Object`, `Where-Object`-style cmdlets that take a `ScriptBlock`
 *   (`ForEach-Object { Remove-Item x }` reads nothing worth trusting);
 * - anything that writes a file (`Set-Content`, `Out-File`, `Tee-Object`,
 *   `Export-Csv`, `New-Item`), removes one, or changes process state;
 * - `Invoke-Item` (opens the target with its shell handler) and `Start-Sleep`'s
 *   neighbours in the "spawn" family.
 *
 * Aliases resolve through `resolveToCanonical`, so `ls` is judged as
 * `Get-ChildItem` — and an alias that does not resolve (`sort`, `sc`, …) never
 * reaches these sets, which keeps an ambiguous name out of the auto-allow path.
 */

import {
  classifyCommandName,
  resolveToCanonical,
} from "../../utils/powershellStructure/canonical.js";
import type { ParsedCommandElement } from "../../utils/powershellStructure/types.js";

/** Cmdlets that read or transform data and write only to the pipeline. */
const READ_ONLY_CMDLETS: ReadonlySet<string> = new Set([
  // Files and directories
  "get-childitem",
  "get-content",
  "get-item",
  "get-itemproperty",
  "get-filehash",
  "get-acl",
  "test-path",
  "resolve-path",
  "split-path",
  "join-path",
  "convert-path",
  "get-location",
  // Searching and text
  "select-string",
  // Discovery
  "get-command",
  "get-help",
  "get-member",
  "get-module",
  "get-alias",
  "get-variable",
  "get-psdrive",
  "get-history",
  "get-date",
  "get-random",
  "get-process",
  "get-service",
  "get-pssession",
  // Data shaping — neutral pipeline stages. None of them writes, spawns or
  // executes; they are here so `Get-ChildItem | Sort-Object` stays read-only.
  "sort-object",
  "group-object",
  "measure-object",
  "select-object",
  "compare-object",
  "get-unique",
  "format-table",
  "format-list",
  "format-wide",
  "format-custom",
  "out-string",
  "write-output",
  "write-host",
  "convertto-json",
  "convertfrom-json",
  "start-sleep",
]);

/**
 * Read-only cmdlets whose positional arguments name files. They are the ones
 * whose paths have to stay inside the Safe Zone — reading `/etc/shadow` or
 * `C:\Users\other\.ssh\id_rsa` is not the same favour as listing the workdir.
 */
const PATH_ARGUMENT_CMDLETS: ReadonlySet<string> = new Set([
  "get-childitem",
  "get-content",
  "get-item",
  "get-itemproperty",
  "get-filehash",
  "get-acl",
  "test-path",
  "resolve-path",
  "select-string",
  "convert-path",
  "split-path",
]);

/**
 * Cmdlets whose first positional argument is data, not a path
 * (`Select-String <pattern> <path>`), so it must not be judged as one.
 */
const FIRST_POSITIONAL_IS_DATA: ReadonlySet<string> = new Set([
  "select-string",
]);

/** Named parameters whose bound value is a path. */
const PATH_PARAMETERS = new Set([
  "-path",
  "-literalpath",
  "-filepath",
  "-destination",
]);

/** The canonical, lowercased cmdlet name of a parsed command. */
function canonicalName(leaf: ParsedCommandElement): string {
  return resolveToCanonical(leaf.name).toLowerCase();
}

/**
 * true when this command cannot write, spawn or execute by name alone.
 *
 * A path-shaped name is an application, not a cmdlet (`.\script.ps1`), so it is
 * never read-only however it is spelled.
 */
export function isReadOnlyCmdlet(name: string): boolean {
  const canonical = resolveToCanonical(name);
  if (classifyCommandName(canonical) !== "cmdlet") return false;
  return READ_ONLY_CMDLETS.has(canonical.toLowerCase());
}

/**
 * Path arguments of a command whose paths matter: positional file arguments of
 * the read-only cmdlets above, plus the bound value of `-Path` / `-LiteralPath`
 * style parameters.
 *
 * Returns `[]` for a cmdlet that takes no paths, which is the common case and
 * not a failure — `Get-Date` names nothing on disk.
 */
export function extractPathArguments(leaf: ParsedCommandElement): string[] {
  const canonical = canonicalName(leaf);
  if (!PATH_ARGUMENT_CMDLETS.has(canonical)) return [];

  const paths: string[] = [];
  const positional: string[] = [];
  for (let index = 0; index < leaf.args.length; index++) {
    const arg = leaf.args[index]!;
    const boundIndex = arg.indexOf(":");
    const parameter = (
      boundIndex > 0 ? arg.slice(0, boundIndex) : arg
    ).toLowerCase();

    if (PATH_PARAMETERS.has(parameter)) {
      // `-Path C:\x` and `-Path:C:\x` are the same binding.
      const bound =
        boundIndex > 0 ? arg.slice(boundIndex + 1) : leaf.args[++index];
      if (bound) paths.push(bound);
      continue;
    }

    if (!arg.startsWith("-")) positional.push(arg);
  }

  const candidates = FIRST_POSITIONAL_IS_DATA.has(canonical)
    ? positional.slice(1)
    : positional;
  return [...candidates, ...paths];
}
