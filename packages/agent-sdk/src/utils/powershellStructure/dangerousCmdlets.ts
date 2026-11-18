/**
 * Cmdlets that are dangerous for a *reason*, grouped by that reason.
 *
 * Pure data: the groups below are the vocabulary the permission engine (P3c)
 * and the rule-suggestion gate both need, kept in one place so a cmdlet added
 * here is picked up by every consumer. Nothing in this module decides a
 * verdict — it says "this name belongs to this hazard class", and the caller
 * decides whether the invocation is a problem (a `ScriptBlock` argument is not
 * the same as a `StringConstant` one).
 *
 * Every name is lowercase; PowerShell is case-insensitive and `nameType` for
 * an alias is not a cmdlet name, so callers normally feed the output of
 * `resolveToCanonical()` in, not the raw element name.
 *
 * Ported from CC's `utils/powershell/dangerousCmdlets.ts` with the groups
 * unchanged. Two things are deliberately not ported: CC's cross-platform
 * interpreter list (`node`, `python`, …) and its fig-spec prefix machinery —
 * wave's bash side has no equivalent of either, and inventing one here would
 * make the PowerShell side stricter than the shell it is replacing.
 */

import { aliasesOf, resolveToCanonical } from "./canonical.js";

/**
 * Cmdlets that take a `-FilePath` (or a positional path) and run the file as
 * a script: the path is the payload, so `-FilePath` alone is not the hazard —
 * the invocation is.
 */
export const FILEPATH_EXECUTION_CMDLETS = [
  "invoke-command",
  "start-job",
  "start-threadjob",
  "register-scheduledjob",
] as const;

/**
 * Cmdlets where a `ScriptBlock` argument is executed rather than used as a
 * filter. `Where-Object { … }` transforms pipeline input; `Invoke-Command { … }`
 * runs arbitrary code on the spot.
 */
export const DANGEROUS_SCRIPT_BLOCK_CMDLETS = [
  "invoke-command",
  "invoke-expression",
  "start-job",
  "start-threadjob",
  "register-scheduledjob",
  "register-engineevent",
  "register-objectevent",
  "register-wmievent",
  "new-pssession",
  "enter-pssession",
] as const;

/**
 * Module/script loading. A `.psm1` runs its top-level body on import, so
 * `Import-Module` is `Invoke-Expression` with extra steps.
 */
export const MODULE_LOADING_CMDLETS = [
  "import-module",
  "install-module",
  "save-module",
  "update-module",
  "install-script",
  "save-script",
] as const;

/**
 * Shells and process spawners: each one hands execution to something wave
 * cannot see into, so no argument list makes it inspectable.
 */
export const SHELLS_AND_SPAWNERS = [
  "pwsh",
  "powershell",
  "cmd",
  "bash",
  "wsl",
  "sh",
  "start-process",
  "add-type",
  "new-object",
] as const;

/**
 * Network cmdlets. A wildcard rule for one of these enables download — and
 * paired with `iex`, exfiltration — without another prompt; there is no
 * legitimate narrow prefix to fall back to.
 */
export const NETWORK_CMDLETS = [
  "invoke-webrequest",
  "invoke-restmethod",
] as const;

/**
 * Alias/variable mutation. `Set-Alias` changes what a later name runs, and
 * `Set-Variable` can poison `$PSDefaultParameterValues` — a command that
 * rewrites the meaning of other commands cannot be pre-approved by name.
 */
export const ALIAS_HIJACK_CMDLETS = [
  "set-alias",
  "sal",
  "new-alias",
  "nal",
  "set-variable",
  "sv",
  "new-variable",
  "nv",
] as const;

/**
 * WMI/CIM process spawn: `Invoke-WmiMethod -Class Win32_Process -Name Create`
 * is `Start-Process` that bypasses every check written against `Start-Process`.
 */
export const WMI_CIM_CMDLETS = [
  "invoke-wmimethod",
  "iwmi",
  "invoke-cimmethod",
] as const;

/**
 * Cmdlets that are only dangerous for *some* arguments — the argument decides,
 * so approving a name-wide rule would approve the argument nobody read.
 *
 * `ForEach-Object { Remove-Item -Recurse / }` is the canonical example: a
 * `ForEach-Object:*` rule matches every future invocation regardless of the
 * scriptblock it carries. `ipconfig` / `hostname` / `route` are native
 * executables in the same position (`ipconfig /flushdns` is not `ipconfig /all`).
 */
export const ARG_GATED_CMDLETS = [
  "select-object",
  "sort-object",
  "group-object",
  "where-object",
  "measure-object",
  "write-output",
  "write-host",
  "start-sleep",
  "format-table",
  "format-list",
  "format-wide",
  "format-custom",
  "out-string",
  "out-host",
  "ipconfig",
  "hostname",
  "route",
] as const;

/**
 * The groups above, addressable by hazard class. P3c reads this to say *why*
 * a command needed a prompt; tests read it to assert the groups stay disjoint
 * in spirit (a name may legitimately appear twice — `invoke-command` is both a
 * `-FilePath` runner and a scriptblock runner).
 */
export const DANGEROUS_CMDLET_GROUPS = {
  filepathExecution: FILEPATH_EXECUTION_CMDLETS,
  scriptBlock: DANGEROUS_SCRIPT_BLOCK_CMDLETS,
  moduleLoading: MODULE_LOADING_CMDLETS,
  shellsAndSpawners: SHELLS_AND_SPAWNERS,
  network: NETWORK_CMDLETS,
  aliasHijack: ALIAS_HIJACK_CMDLETS,
  wmiCim: WMI_CIM_CMDLETS,
  argGated: ARG_GATED_CMDLETS,
} as const;

export type DangerousCmdletCategory = keyof typeof DANGEROUS_CMDLET_GROUPS;

/** Every name in every group, lowercased. */
export const DANGEROUS_CMDLET_NAMES: ReadonlySet<string> = new Set(
  Object.values(DANGEROUS_CMDLET_GROUPS).flat(),
);

/**
 * Which hazard class a command name belongs to, or `undefined` for the
 * cmdlets nothing here complains about. Aliases are resolved first, so `iex`
 * and `Invoke-Expression` answer the same; a name in two groups answers with
 * the first group listed in `DANGEROUS_CMDLET_GROUPS`.
 */
export function dangerousCmdletGroup(
  name: string,
): DangerousCmdletCategory | undefined {
  const canonical = resolveToCanonical(name).toLowerCase();
  for (const [category, names] of Object.entries(DANGEROUS_CMDLET_GROUPS)) {
    if ((names as readonly string[]).includes(canonical)) {
      return category as DangerousCmdletCategory;
    }
  }
  return undefined;
}

/**
 * Cmdlets whose reach is the whole filesystem, or another command's meaning.
 *
 * wave's bash side never offers a persistent rule for `rm` / `mv` — they are
 * in `DANGEROUS_COMMANDS`, so `getSmartPrefix` returns null. The PowerShell
 * cmdlets below have the same reach, so they get the same treatment: a
 * `PowerShell(Remove-Item:*)` rule is a permanent yes for deleting anything,
 * and the moment it exists nobody is asked again.
 */
const DESTRUCTIVE_CMDLETS = [
  "remove-item",
  "move-item",
  "rename-item",
  "clear-item",
  "set-item",
  "set-itemproperty",
  "remove-itemproperty",
  "set-content",
  "add-content",
  "clear-content",
  "new-item",
  "out-file",
  "tee-object",
  "export-csv",
  "export-alias",
  "set-clipboard",
] as const;

/**
 * `ForEach-Object` is not in any group above but must not be suggested: its
 * `-MemberName` form (`% Delete`) resolves against the runtime pipeline object,
 * so `Get-ChildItem | % Delete` calls `FileInfo.Delete()` with nothing in the
 * command text that says so. Scriptblock and member-name forms are the same
 * cmdlet and the parser cannot tell which one a rule would be approving.
 */
const NEVER_SUGGEST_EXTRA = ["foreach-object"] as const;

/**
 * Commands a wildcard rule must never be suggested for, aliases included:
 * `del:*` is as bad as `Remove-Item:*`.
 *
 * Derived, not maintained: add a cmdlet to a group above (or to
 * `DESTRUCTIVE_CMDLETS`) and it appears here. The only manual step is the
 * reverse index in `canonical.ts` — an alias that is not in `COMMON_ALIASES`
 * stays unresolved and therefore never reaches this set.
 */
export const NEVER_SUGGEST: ReadonlySet<string> = (() => {
  const names = new Set<string>([
    ...DANGEROUS_CMDLET_NAMES,
    ...DESTRUCTIVE_CMDLETS,
    ...NEVER_SUGGEST_EXTRA,
  ]);
  for (const name of [...names]) {
    for (const alias of aliasesOf(name)) names.add(alias);
  }
  return names;
})();
