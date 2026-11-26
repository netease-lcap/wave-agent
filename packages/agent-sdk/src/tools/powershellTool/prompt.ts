/**
 * The PowerShell tool's description.
 *
 * Modelled on Claude Code's `tools/PowerShellTool/prompt.ts`, including its
 * `run_in_background` note and the `Start-Sleep` guidance that note justifies
 * (CC's `getBackgroundUsageNote()` / `getSleepGuidance()`, same bullets). Two
 * things are wave's own:
 *
 * - the dedicated-tool list depends on which tools this request declares flat
 *   (`Grep` / `Glob` sit in the REPL pool while folded, see
 *   `utils/searchToolsRegistration.ts`), so it cannot be a constant string.
 *
 * The "Unix commands that DO NOT exist in PowerShell" table and the exit-code
 * note after it are copied verbatim from CC's prompt (binary `@343205396` and
 * `@343206581`). The table is what lets the builtin skill and command bodies stay
 * single-source: they are written in bash, and CC relies on the model reading
 * them and translating with this table rather than shipping a PowerShell twin of
 * every body.
 *
 * Telling the model to *end* commands with `exit $LASTEXITCODE` is still absent
 * on purpose: the provider appends its own probe
 * (`utils/shell/powershellProvider.ts`), so the tool reports a native program's
 * code without the model doing anything. The exit-code note is a different
 * thing — it explains why a cmdlet failure survives `-ErrorAction
 * SilentlyContinue`.
 *
 * The note's recipe is CC's sentence with one correction: CC ends it in an
 * empty `catch`, which does not reset `$?`, so its "truly non-fatal" recipe
 * still reported exit 1 — in CC exactly as here, since both append the same
 * probe (`$_ec = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($?) { 0 }
 * else { 1 }`). Measured on Windows PowerShell 5.1: `Get-Item C:/nope
 * -ErrorAction SilentlyContinue` → 1, `try { … -ErrorAction Stop } catch {}` →
 * 1, the same with `catch { $null }` → 0. The advice is corrected rather than
 * dropped because "promote to terminating before swallowing" is still right —
 * only the swallow needs a statement to count as handled.
 *
 * The edition section exists because the model cannot tell which PowerShell it
 * is talking to: 5.1 rejects `&&` with a parser error, while 7 supports the
 * bash-like operators. Feeding the wrong one costs a round trip on every chained
 * command.
 *
 * There is no lean variant, and that is deliberate: CC's PowerShellTool has none.
 * Its definition (`@343320400`) is `async prompt(e){return kta(zCe(e?.tools??[]))}`
 * — `prompt` takes no `leanPrompt` argument and never calls the `jM` gate that
 * `BashTool` (`@330422200`) consults, so CC's PowerShell description is the same
 * text in both prompt tiers. Since this tool's description is where the
 * bash → PowerShell table lives, a condensed variant would have dropped it for
 * every lean session — which is the default. `leanPrompt` mode therefore leaves
 * this tool's description alone, like CC does.
 */

import { BASH_MAX_OUTPUT_BYTES } from "../../constants/toolLimits.js";
import {
  EDIT_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  POWERSHELL_TOOL_NAME,
  READ_TOOL_NAME,
  WRITE_TOOL_NAME,
} from "../../constants/tools.js";
import {
  getPowerShellEdition,
  type PowerShellEdition,
} from "../../utils/shell/powershellDetection.js";
import type { ToolPromptArgs } from "../types.js";

export const POWERSHELL_DEFAULT_TIMEOUT_MS = 120000;
export const POWERSHELL_MAX_TIMEOUT_MS = 600000;

/**
 * Version-specific syntax guidance. `undefined` means the edition was not
 * resolved (no binary on `PATH`, or the first prompt build before a lookup) —
 * and then 5.1's conservative rules apply, because a command written for 5.1
 * runs on both while one written for 7 parse-errors on 5.1.
 */
function editionSection(edition: PowerShellEdition | undefined): string {
  if (edition === "core") {
    return `PowerShell edition: PowerShell 7+ (pwsh)
   - Pipeline chain operators \`&&\` and \`||\` ARE available and behave like bash. Prefer \`cmd1 && cmd2\` when cmd2 should only run if cmd1 succeeds.
   - Ternary (\`$cond ? $a : $b\`), null-coalescing (\`??\`) and null-conditional (\`?.\`) are available.
   - Default file encoding is UTF-8 without BOM.`;
  }
  if (edition === "desktop") {
    return `PowerShell edition: Windows PowerShell 5.1 (powershell.exe)
   - Pipeline chain operators \`&&\` and \`||\` are NOT available — they are a parser error. Chain conditionally with \`A; if ($?) { B }\`, unconditionally with \`A; B\`, and for "B only if A failed" use \`A; if (-not $?) { B }\`.
   - Ternary (\`?:\`), null-coalescing (\`??\`) and null-conditional (\`?.\`) are NOT available. Use \`if/else\` and explicit \`$null -eq\` checks.
   - Do NOT redirect the stderr of a native executable (\`2>&1\`). In 5.1 that wraps every stderr line in an ErrorRecord (NativeCommandError) and sets \`$?\` to \`$false\` even when the exe exited 0. stderr is already captured for you — leave it alone.
   - \`Out-File\` / \`Set-Content\` default to UTF-16 LE with BOM. Pass \`-Encoding utf8\` when another tool will read the file.
   - \`ConvertFrom-Json\` returns a PSCustomObject, not a hashtable; \`-AsHashtable\` is not available.`;
  }
  return `PowerShell edition: unknown — assume Windows PowerShell 5.1 for compatibility
   - Do NOT use \`&&\`, \`||\`, ternary \`?:\`, null-coalescing \`??\` or null-conditional \`?.\`: they are PowerShell 7+ only and parse-error on 5.1. Chain conditionally with \`A; if ($?) { B }\`, unconditionally with \`A; B\`.
   - Do NOT redirect a native executable's stderr (\`2>&1\`), and pass \`-Encoding utf8\` to \`Out-File\` / \`Set-Content\` — the 5.1 defaults (\`$?\` clobbered by NativeCommandError, UTF-16 LE files) are the ones that break other tools.`;
}

/** Whether the session registered the structured search tools. */
function hasSearchTools(args?: ToolPromptArgs): boolean {
  const available = args?.availableTools ?? [];
  return available.some(
    (name) => name === GLOB_TOOL_NAME || name === GREP_TOOL_NAME,
  );
}

/**
 * The "use the dedicated tool instead" bullets. With `Grep` / `Glob` absent —
 * which is the usual PowerShell session, since search runs through the Bash
 * tool's shadows and there is no bash — searching really belongs to this tool,
 * so the two lines point back here instead of at tools the model cannot call.
 */
function dedicatedToolLines(args?: ToolPromptArgs): string[] {
  const search = hasSearchTools(args)
    ? [
        `    - File search: Use ${GLOB_TOOL_NAME} (NOT \`Get-ChildItem -Recurse\`)`,
        `    - Content search: Use ${GREP_TOOL_NAME} (NOT \`Select-String\`)`,
      ]
    : [
        "    - File search: use `Get-ChildItem -Recurse` here — this session has no Glob tool",
        "    - Content search: use `Select-String` here — this session has no Grep tool",
      ];
  return [
    ...search,
    `    - Read files: Use ${READ_TOOL_NAME} (NOT \`Get-Content\`)`,
    `    - Edit files: Use ${EDIT_TOOL_NAME} (NOT \`(Get-Content …) -replace … | Set-Content\`)`,
    `    - Write files: Use ${WRITE_TOOL_NAME} (NOT \`Set-Content\` / \`Out-File\`)`,
    "    - Communication: output text directly (NOT `Write-Output` / `Write-Host`)",
  ];
}

export function powershellPrompt(args?: ToolPromptArgs): string {
  const edition = editionSection(getPowerShellEdition());
  return `Executes a given PowerShell command with optional timeout. Each call is a fresh process (\`-NoProfile -NonInteractive -NoLogo -Command\`): the working directory persists between calls (it is tracked and restored for you), but shell state — variables, functions, aliases — does not.

${edition}

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use \`Get-ChildItem\` (or \`ls\`) to verify the parent directory exists and is the correct location

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes
   - Capture the output of the command.

PowerShell syntax notes:
   - Verb-Noun cmdlet naming: \`Get-ChildItem\`, \`Set-Location\`, \`New-Item\`, \`Remove-Item\`. Common aliases: \`ls\` (Get-ChildItem), \`cd\` (Set-Location), \`cat\` (Get-Content), \`rm\` (Remove-Item)
   - The escape character is the backtick, not the backslash
   - The pipe passes objects, not text: filter and transform with \`Select-Object\` / \`Where-Object\` / \`ForEach-Object\`
   - String interpolation: \`"Hello $name"\` or \`"Hello $($obj.Property)"\`
   - Environment variables: read with \`$env:NAME\`, set with \`$env:NAME = "value"\` (NOT \`Set-Variable\` or bash \`export\`)
   - Registry access uses PSDrive prefixes — \`HKLM:\\SOFTWARE\\...\`, \`HKCU:\\...\` — NOT raw \`HKEY_LOCAL_MACHINE\\...\`
   - Call a native exe whose path has spaces with the call operator: \`& "C:\\Program Files\\App\\app.exe" arg1 arg2\`

Unix commands that DO NOT exist in PowerShell — use the equivalent instead:
   - head / tail → \`Get-Content file -TotalCount N\` / \`-Tail N\`; piped: \`| Select-Object -First N\` / \`-Last N\`
   - which → \`(Get-Command name).Source\`
   - touch → \`if (-not (Test-Path path)) { New-Item -ItemType File path }\` (NEVER use \`New-Item -Force\` on a file — it truncates existing content)
   - wc -l → \`(Get-Content file | Measure-Object -Line).Lines\`
   - mkdir -p → \`New-Item -ItemType Directory -Force path\` (\`-p\` is not a PowerShell flag)
   - rm -rf → \`Remove-Item -Recurse -Force path\`
   - ln -s → \`New-Item -ItemType SymbolicLink -Path link -Target target\`
   - chmod / chown → not applicable on Windows; use \`icacls\` only if ACL changes are required
   - 2>/dev/null → \`2>$null\` (but stderr is captured for you — usually unnecessary)
   - VAR=x cmd → \`$env:VAR = 'x'; cmd\` (PowerShell has no inline env-var prefix)
   - Bash control flow (\`if [ -f x ]\`, \`for x in *\`, backtick \`\`cmd\`\` substitution) is a parser error — use \`if (Test-Path x)\`, \`foreach ($x in ...)\`, \`$(cmd)\`

Exit-code note: \`-ErrorAction SilentlyContinue\` suppresses error OUTPUT but the cmdlet failure still causes this tool to report exit 1. To make a cmdlet failure truly non-fatal, promote it to terminating and swallow it with a statement inside \`catch\`: \`try { Cmdlet ... -ErrorAction Stop } catch { $null }\` (without \`-ErrorAction Stop\`, non-terminating errors skip the \`catch\` and still exit 1; and the \`catch\` block may not be left empty, because an empty block does not reset \`$?\` and the call still reports exit 1).

Interactive and blocking commands (this tool runs with \`-NonInteractive\`, so they hang):
   - NEVER use \`Read-Host\`, \`Get-Credential\`, \`Out-GridView\`, \`$Host.UI.PromptForChoice\`, or \`pause\`
   - Destructive cmdlets (\`Remove-Item\`, \`Stop-Process\`, \`Clear-Content\`, …) may ask for confirmation. Add \`-Confirm:$false\` when you intend the action to proceed, and \`-Force\` for read-only or hidden items.
   - Never use \`git rebase -i\`, \`git add -i\`, or any other command that opens an interactive editor

Passing multiline strings (commit messages, file content) to native executables:
   - Use a single-quoted here-string so PowerShell expands nothing inside. The closing \`'@\` MUST sit at column 0 on its own line — one leading space is a parse error:
<example>
git commit -m @'
Commit message here.
Second line with $literal dollar signs.
'@
</example>
   - Use \`@'...'@\` (single-quoted, literal) rather than \`@"..."@\` (double-quoted, interpolated) unless you need expansion
   - For arguments containing \`-\`, \`@\` or other characters PowerShell reads as operators, use the stop-parsing token: \`git log --% --format=%H\`

Usage notes:
   - The command argument is required.
   - You may specify an optional timeout in milliseconds (up to ${POWERSHELL_MAX_TIMEOUT_MS}ms / ${POWERSHELL_MAX_TIMEOUT_MS / 60000} minutes). By default a command times out after ${POWERSHELL_DEFAULT_TIMEOUT_MS}ms (${POWERSHELL_DEFAULT_TIMEOUT_MS / 60000} minutes).
   - It is very helpful if you write a clear, concise description of what this command does.
   - If the output exceeds ${BASH_MAX_OUTPUT_BYTES.toLocaleString()} bytes (UTF-8), it is truncated and the full output persisted to a file you can read with the ${READ_TOOL_NAME} tool.
   - You can use the \`run_in_background\` parameter to run the command in the background. Only use this if you don't need the result immediately and are OK being notified when the command completes later. You do not need to check the output right away — you'll be notified when it finishes.
   - Avoid using ${POWERSHELL_TOOL_NAME} to run commands that have dedicated tools, unless explicitly instructed:
${dedicatedToolLines(args).join("\n")}
   - When issuing multiple commands:
     - If the commands are independent, make multiple ${POWERSHELL_TOOL_NAME} tool calls in a single message.
     - If they depend on each other, chain them in one ${POWERSHELL_TOOL_NAME} call (see the edition-specific chaining syntax above).
     - Use \`;\` only when you need to run commands sequentially but do not care whether earlier ones failed.
     - Do NOT separate commands with newlines (newlines are fine inside quoted strings and here-strings).
   - Do NOT prefix commands with \`cd\` or \`Set-Location\` — the working directory is already the project directory.
   - For git commands:
     - Prefer to create a new commit rather than amending an existing one.
     - Before running a destructive operation (\`git reset --hard\`, \`git push --force\`, \`git checkout --\`), consider whether a safer alternative reaches the same goal. Only use destructive operations when they really are the best approach.
     - Never skip hooks (\`--no-verify\`) or bypass signing (\`--no-gpg-sign\`, \`-c commit.gpgsign=false\`) unless the user explicitly asked for it. If a hook fails, investigate and fix the underlying issue.

# Avoid unnecessary sleep commands
   - Do not \`Start-Sleep\` between commands that can run immediately — just run them.
   - If your command is long running and you would like to be notified when it finishes — use \`run_in_background\`. No sleep needed.
   - Do not retry failing commands in a sleep loop — diagnose the root cause.
   - If waiting for a background task you started with \`run_in_background\`, you will be notified when it completes — do not poll.
   - If you must poll an external process, use a check command rather than sleeping first.
   - If you must sleep, keep the duration short (1-5 seconds) to avoid blocking the user.`;
}
