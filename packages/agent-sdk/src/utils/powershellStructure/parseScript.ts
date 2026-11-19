/**
 * The PowerShell script that does the actual parsing, and the argv machinery
 * around it.
 *
 * Why spawn a real `powershell.exe` per command instead of parsing in JS: the
 * PowerShell grammar is large and version-dependent (5.1 vs 7 differ on `&&`,
 * ternary, null-coalescing), and a hand-written approximation would be wrong in
 * exactly the cases an attacker picks. The shell that will *execute* the
 * command is the authority on what the command means, so the parser asks it.
 *
 * Cost control:
 * - The user command goes in as base64 of its UTF-8 bytes (never interpolated
 *   into the script), and the whole script goes through `-EncodedCommand`
 *   (base64 of UTF-16LE), so no quoting or escaping layer exists at all.
 * - A parse is ~600-700 ms warm on Windows PowerShell 5.1, so results are
 *   cached by command string in `psParser.ts`; a session re-parsing the same
 *   `git status` dozens of times must not pay that repeatedly.
 * - The script is deliberately smaller than Claude Code's equivalent: no type
 *   literal collection, no `using` statement flag, no `#Requires` flag. We do
 *   not act on those, and every unused field is bytes of argv we cannot spend
 *   on the command itself (see `MAX_PARSE_COMMAND_BYTES`).
 */

/**
 * The parse body. `-EncodedCommand` prepends `$EncodedCommand = '<b64>'`, so
 * this text may not start with a `using` statement (`UsingMustBeAtStartOfScript`)
 * and must use fully-qualified type names instead.
 *
 * Output contract: one JSON object on stdout (compressed), see `RawParsedOutput`
 * in `types.ts`. `-Depth 10` covers `statements[].elements[].commandElements[]`.
 */
export const PARSE_SCRIPT_BODY = `try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$ProgressPreference = 'SilentlyContinue'
$Command = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($EncodedCommand))
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($Command, [ref]$tokens, [ref]$parseErrors)

function Get-Elements($CmdAst) {
  $out = [System.Collections.ArrayList]::new()
  foreach ($ce in $CmdAst.CommandElements) {
    $d = @{ type = $ce.GetType().Name; text = $ce.Extent.Text }
    if (($ce -is [System.Management.Automation.Language.StringConstantExpressionAst]) -or ($ce -is [System.Management.Automation.Language.ExpandableStringExpressionAst])) { $d.value = [string]$ce.Value }
    if ($ce -is [System.Management.Automation.Language.CommandExpressionAst]) { $d.expressionType = $ce.Expression.GetType().Name }
    [void]$out.Add($d)
  }
  return $out
}

function Get-Redirs($Redirs) {
  $out = [System.Collections.ArrayList]::new()
  foreach ($r in $Redirs) {
    $d = @{ type = $r.GetType().Name }
    if ($r -is [System.Management.Automation.Language.FileRedirectionAst]) {
      $d.append = [bool]$r.Append
      $d.fromStream = $r.FromStream.ToString()
      $d.locationText = $r.Location.Extent.Text
    }
    [void]$out.Add($d)
  }
  return $out
}

function Get-Patterns($Node) {
  $p = @{}
  $found = $Node.FindAll({ param($x)
    ($x -is [System.Management.Automation.Language.MemberExpressionAst]) -or
    ($x -is [System.Management.Automation.Language.InvokeMemberExpressionAst]) -or
    ($x -is [System.Management.Automation.Language.SubExpressionAst]) -or
    ($x -is [System.Management.Automation.Language.ArrayExpressionAst]) -or
    ($x -is [System.Management.Automation.Language.ParenExpressionAst]) -or
    ($x -is [System.Management.Automation.Language.ExpandableStringExpressionAst]) -or
    ($x -is [System.Management.Automation.Language.ScriptBlockExpressionAst])
  }, $true)
  foreach ($n in $found) {
    switch ($n.GetType().Name) {
      'MemberExpressionAst' { $p.hasMemberInvocations = $true }
      'InvokeMemberExpressionAst' { $p.hasMemberInvocations = $true }
      'SubExpressionAst' { $p.hasSubExpressions = $true }
      'ArrayExpressionAst' { $p.hasSubExpressions = $true }
      'ParenExpressionAst' { $p.hasSubExpressions = $true }
      'ExpandableStringExpressionAst' { $p.hasExpandableStrings = $true }
      'ScriptBlockExpressionAst' { $p.hasScriptBlocks = $true }
    }
  }
  if ($p.Count -gt 0) { return $p }
  return $null
}

function Get-Statement($Node) {
  $s = @{ type = $Node.GetType().Name; text = $Node.Extent.Text }
  if ($Node -is [System.Management.Automation.Language.PipelineAst]) {
    $els = [System.Collections.ArrayList]::new()
    foreach ($el in $Node.PipelineElements) {
      $d = @{ type = $el.GetType().Name; text = $el.Extent.Text }
      if ($el -is [System.Management.Automation.Language.CommandAst]) {
        $d.commandElements = @(Get-Elements $el)
        $d.redirections = @(Get-Redirs $el.Redirections)
      } elseif ($el -is [System.Management.Automation.Language.CommandExpressionAst]) {
        $d.expressionType = $el.Expression.GetType().Name
        $d.redirections = @(Get-Redirs $el.Redirections)
      }
      [void]$els.Add($d)
    }
    $s.elements = @($els)
  }
  $nested = [System.Collections.ArrayList]::new()
  foreach ($c in $Node.FindAll({ param($x) $x -is [System.Management.Automation.Language.CommandAst] }, $true)) {
    if ($c.Parent -ne $Node) {
      [void]$nested.Add(@{
        type = 'CommandAst'
        text = $c.Extent.Text
        commandElements = @(Get-Elements $c)
        redirections = @(Get-Redirs $c.Redirections)
      })
    }
  }
  if ($nested.Count -gt 0) { $s.nestedCommands = @($nested) }
  $r = $Node.FindAll({ param($x) $x -is [System.Management.Automation.Language.FileRedirectionAst] }, $true)
  if ($r.Count -gt 0) { $s.redirections = @(Get-Redirs $r) }
  $p = Get-Patterns $Node
  if ($p) { $s.securityPatterns = $p }
  return $s
}

$statements = [System.Collections.ArrayList]::new()
foreach ($block in @($ast.BeginBlock, $ast.ProcessBlock, $ast.EndBlock, $ast.CleanBlock, $ast.DynamicParamBlock)) {
  if (-not $block) { continue }
  foreach ($stmt in $block.Statements) { [void]$statements.Add((Get-Statement $stmt)) }
  if ($block.Traps) { foreach ($trap in $block.Traps) { [void]$statements.Add((Get-Statement $trap)) } }
}
if ($ast.ParamBlock) {
  $pb = Get-Statement $ast.ParamBlock
  if ($pb.nestedCommands -or $pb.redirections -or $pb.securityPatterns) { [void]$statements.Add($pb) }
}

$vars = [System.Collections.ArrayList]::new()
foreach ($v in $ast.FindAll({ param($x) $x -is [System.Management.Automation.Language.VariableExpressionAst] }, $true)) {
  [void]$vars.Add(@{ path = $v.VariablePath.ToString(); isSplatted = [bool]$v.Splatted })
}

$stop = $false
foreach ($tok in $tokens) {
  if ($tok.Kind -eq [System.Management.Automation.Language.TokenKind]::MinusMinus) { $stop = $true; break }
  if (($tok.Kind -eq [System.Management.Automation.Language.TokenKind]::Generic) -and (($tok.Text -replace '[\\u2013\\u2014\\u2015]', '-') -eq '--%')) { $stop = $true; break }
}

@{
  valid = ($parseErrors.Count -eq 0)
  errors = @($parseErrors | ForEach-Object { @{ message = $_.Message; errorId = $_.ErrorId } })
  statements = @($statements)
  variables = @($vars)
  hasStopParsing = $stop
  originalCommand = $Command
} | ConvertTo-Json -Depth 10 -Compress
`;

/**
 * Windows' hard limit for the whole command line (CreateProcess).
 *
 * Exported together with `FIXED_ARGV_OVERHEAD` so the budget guard in
 * `parseScript.test.ts` measures the real argv against the same numbers.
 */
export const WINDOWS_ARGV_CAP = 32767;
/** `"powershell.exe" -NoProfile -NonInteractive -NoLogo -EncodedCommand ` + quotes. */
export const FIXED_ARGV_OVERHEAD = 200;
/** `$EncodedCommand = ''` + newline, inserted before the body. */
const ENCODED_CMD_WRAPPER = "$EncodedCommand = ''\n".length;
/** Headroom for the difference between our estimate and the real argv. */
const SAFETY_MARGIN = 100;

/**
 * Base64 costs 4 chars per 3 bytes, so the script budget in chars caps the
 * user command in bytes. Everything here is derived from
 * `PARSE_SCRIPT_BODY.length`, so growing the script automatically shrinks what
 * it can accept instead of silently failing at spawn time.
 */
const SCRIPT_CHARS_BUDGET = ((WINDOWS_ARGV_CAP - FIXED_ARGV_OVERHEAD) * 3) / 8;
const COMMAND_B64_BUDGET =
  SCRIPT_CHARS_BUDGET - PARSE_SCRIPT_BODY.length - ENCODED_CMD_WRAPPER;

/**
 * Longest command (in UTF-8 bytes) we will try to parse. Beyond this the argv
 * would not fit and `CreateProcess` fails with an opaque error, so we refuse up
 * front with `CommandTooLong` — which the caller treats as "ask", same as any
 * other parse failure.
 */
export const MAX_PARSE_COMMAND_BYTES = Math.max(
  0,
  Math.floor((COMMAND_B64_BUDGET * 3) / 4) - SAFETY_MARGIN,
);

/** base64 of the UTF-8 command bytes, as the body expects to read it. */
export function encodeCommandForScript(command: string): string {
  return Buffer.from(command, "utf8").toString("base64");
}

/**
 * `-EncodedCommand` takes base64 of UTF-16LE. That is also what keeps quotes,
 * `%`, newlines and non-ASCII out of the argv entirely.
 */
export function toUtf16LeBase64(text: string): string {
  return Buffer.from(text, "utf16le").toString("base64");
}

/**
 * The full script for one command: the encoded user command bound to
 * `$EncodedCommand`, then the body.
 */
export function buildParseScript(command: string): string {
  return `$EncodedCommand = '${encodeCommandForScript(command)}'\n${PARSE_SCRIPT_BODY}`;
}
