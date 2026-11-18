/**
 * What a command name *is*, once PowerShell has finished resolving aliases.
 *
 * The parser reports the name as written (`ls`, `%`, `Microsoft.PowerShell.Management\Get-ChildItem`).
 * Every security decision downstream — is this cmdlet read-only? is it in a
 * dangerous group? what rule text should the dialog suggest? — needs the
 * cmdlet name instead, and needs the same one all three consumers agree on.
 * That normalisation lives here.
 *
 * `classifyCommandName` / `stripModulePrefix` are re-exported from
 * `transform.ts` rather than reimplemented: the parser already needs them to
 * fill in `nameType`, and two copies of "what counts as a cmdlet name" would
 * drift.
 *
 * ## Why the table is a `Map`
 *
 * CC builds its alias table with `Object.create(null)` so a command named
 * `constructor` or `toString` cannot resolve to an `Object.prototype` member.
 * A `Map` has the same property with less ceremony: `COMMON_ALIASES.get("constructor")`
 * is `undefined`, so such a command falls through as its own name.
 *
 * ## Why the table is short
 *
 * It carries one entry per alias wave will actually meet, not PowerShell's
 * full ~150-alias table. Two groups are deliberately absent:
 *
 * - **Aliases that collide with a native executable.** Measured on this
 *   machine (Windows PowerShell 5.1.26100): `sc` → `Set-Content`, `sort` →
 *   `Sort-Object`, `curl`/`wget` → `Invoke-WebRequest`, while `sc.exe`,
 *   `sort.exe`, `curl.exe`, `wget.exe` all exist on PATH. PS Core 6+ dropped
 *   the `sc`/`curl`/`wget` aliases, so the *same text* runs a cmdlet in one
 *   edition and an `.exe` in the other. Resolving such a name would let a
 *   rule or an auto-allow fire for the wrong program; leaving it unresolved
 *   means the name stays `unknown`, which the permission layer treats as
 *   "ask". Users who want the cmdlet can spell it out.
 * - **Names that are not aliases at all.** `ci` resolves to nothing on
 *   5.1 (CC maps it to `Copy-Item`); `new` was never an alias (`ni` is).
 *   Mapping a name nothing binds only creates a rule that can be satisfied by
 *   whatever happens to be on PATH.
 *
 * Resolution is **single-hop**: `md` → `New-Item` is spelled out even though
 * PowerShell itself chains `md` → `mkdir` → `New-Item`, and `mkdir` is a
 * *function* wrapping `New-Item -Type Directory`. Table values are therefore
 * always canonical cmdlet names, never other aliases.
 */

import { classifyCommandName, stripModulePrefix } from "./transform.js";

export { classifyCommandName, stripModulePrefix };

/** Alias → cmdlet, keys lowercased. Values are canonical cmdlet names. */
const ALIASES: Record<string, string> = {
  // Files and directories
  ls: "Get-ChildItem",
  dir: "Get-ChildItem",
  gci: "Get-ChildItem",
  cat: "Get-Content",
  type: "Get-Content",
  gc: "Get-Content",
  cd: "Set-Location",
  sl: "Set-Location",
  chdir: "Set-Location",
  pushd: "Push-Location",
  popd: "Pop-Location",
  pwd: "Get-Location",
  gl: "Get-Location",
  gi: "Get-Item",
  gp: "Get-ItemProperty",
  ni: "New-Item",
  mkdir: "New-Item",
  md: "New-Item",
  ri: "Remove-Item",
  del: "Remove-Item",
  rd: "Remove-Item",
  rmdir: "Remove-Item",
  rm: "Remove-Item",
  erase: "Remove-Item",
  mi: "Move-Item",
  mv: "Move-Item",
  move: "Move-Item",
  cp: "Copy-Item",
  copy: "Copy-Item",
  cpi: "Copy-Item",
  si: "Set-Item",
  rni: "Rename-Item",
  ren: "Rename-Item",

  // Processes and jobs
  ps: "Get-Process",
  gps: "Get-Process",
  kill: "Stop-Process",
  spps: "Stop-Process",
  start: "Start-Process",
  saps: "Start-Process",
  sajb: "Start-Job",

  // Output, lookup, hosts
  echo: "Write-Output",
  write: "Write-Output",
  sleep: "Start-Sleep",
  help: "Get-Help",
  man: "Get-Help",
  gcm: "Get-Command",
  gsv: "Get-Service",
  gv: "Get-Variable",
  sv: "Set-Variable",
  h: "Get-History",
  history: "Get-History",
  cls: "Clear-Host",
  clear: "Clear-Host",

  // Execution, network, modules, sessions
  iex: "Invoke-Expression",
  icm: "Invoke-Command",
  ii: "Invoke-Item",
  iwr: "Invoke-WebRequest",
  irm: "Invoke-RestMethod",
  ipmo: "Import-Module",
  nsn: "New-PSSession",
  etsn: "Enter-PSSession",
  exsn: "Exit-PSSession",
  gsn: "Get-PSSession",
  rsn: "Remove-PSSession",

  // Pipeline verbs
  "%": "ForEach-Object",
  foreach: "ForEach-Object",
  "?": "Where-Object",
  where: "Where-Object",
  select: "Select-Object",
  measure: "Measure-Object",
  ft: "Format-Table",
  fl: "Format-List",
  fw: "Format-Wide",
  oh: "Out-Host",
  ogv: "Out-GridView",
  sls: "Select-String",

  // Content, properties, items
  ac: "Add-Content",
  clc: "Clear-Content",
  tee: "Tee-Object",
  epcsv: "Export-Csv",
  sp: "Set-ItemProperty",
  rp: "Remove-ItemProperty",
  cli: "Clear-Item",
  epal: "Export-Alias",
  scb: "Set-Clipboard",

  // Rebinding: these are on the list because a command *named* like one of
  // them changes what another name resolves to at runtime.
  sal: "Set-Alias",
  nal: "New-Alias",
  nv: "New-Variable",
  iwmi: "Invoke-WmiMethod",
};

/** Alias → cmdlet. Keys are lowercase; look up with `resolveToCanonical`. */
export const COMMON_ALIASES: ReadonlyMap<string, string> = new Map(
  Object.entries(ALIASES),
);

const ALIASES_BY_CANONICAL: ReadonlyMap<string, string[]> = (() => {
  const index = new Map<string, string[]>();
  for (const [alias, canonical] of COMMON_ALIASES) {
    const key = canonical.toLowerCase();
    const existing = index.get(key);
    if (existing) existing.push(alias);
    else index.set(key, [alias]);
  }
  return index;
})();

/**
 * Every alias that resolves to `canonical` (`Get-ChildItem` → `ls`, `dir`,
 * `gci`). Needed wherever a decision is indexed by cmdlet name but the user
 * typed an alias — the dangerous-cmdlet tables are the first such place.
 */
export function aliasesOf(canonical: string): string[] {
  return (
    ALIASES_BY_CANONICAL.get(stripModulePrefix(canonical).toLowerCase()) ?? []
  );
}

/**
 * The name PowerShell will look up, with the module qualifier and any alias
 * removed: `ls` → `Get-ChildItem`, `Microsoft.PowerShell.Management\gi` →
 * `Get-Item`. Unknown names come back as written (minus a module qualifier),
 * which is what the permission layer wants — an unresolved name is `unknown`,
 * not `harmless`.
 */
export function resolveToCanonical(name: string): string {
  const stripped = stripModulePrefix(name);
  return COMMON_ALIASES.get(stripped.toLowerCase()) ?? stripped;
}
