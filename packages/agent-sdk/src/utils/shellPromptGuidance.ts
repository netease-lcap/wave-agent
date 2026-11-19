/**
 * The shell-dependent lines of the builtin subagent prompts.
 *
 * Claude Code writes these prompts as functions that read the session's shell
 * (`rtr()` for Explore, `ltr()` for Plan): both fork on "is bash available" —
 * the tool name, the read-only verb list and the forbidden verb list change
 * with it, and the search line names `Glob` / `Grep` when the bash `find` /
 * `grep` shadows are not there (Claude Code 2.1.327: `_c()` @322404104, Explore
 * @324941020, Plan @324944960).
 *
 * Wave's prompts are markdown (`src/builtin/subagents.ts`) materialized once per
 * process into a content-hashed cache directory (`utils/builtinEmbed.ts`), so
 * they cannot be built per session at that layer. The shell-dependent lines are
 * therefore placeholder lines, resolved by `subagentParser` when a session loads
 * its subagents — through `resolveShellKind`, the same three-state decision that
 * registered the shell tool, so a prompt can never name a tool the session does
 * not have.
 *
 * A session with neither shell is a third state Claude Code does not have (its
 * startup refuses to run at all); wave allows it and registers `Glob` / `Grep`,
 * so the prompt gets no shell guidance and says why.
 */

import {
  BASH_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  POWERSHELL_TOOL_NAME,
  READ_TOOL_NAME,
} from "../constants/tools.js";
import type { ShellKindChoice } from "./shell/shellToolGate.js";

/** Two bullets: how this session searches, in the form that session can run. */
export const SHELL_SEARCH_BULLETS_TOKEN = "{{WAVE_SHELL_SEARCH_BULLETS}}";

/** Inline fragment: the same choice inside a sentence (Plan's bullet). */
export const SHELL_SEARCH_INLINE_TOKEN = "{{WAVE_SHELL_SEARCH_INLINE}}";

/** What the shell tool may and may not be used for. */
export const SHELL_RESTRICTIONS_TOKEN = "{{WAVE_SHELL_RESTRICTIONS}}";

/** Claude Code's bash read-only list, and the PowerShell equivalent it uses. */
const BASH_READ_ONLY =
  "ls, git status, git log, git diff, find, cat, head, tail";
const POWERSHELL_READ_ONLY =
  "Get-ChildItem, git status, git log, git diff, Get-Content, Select-Object -First/-Last";
const BASH_FORBIDDEN = "mkdir, touch, rm, cp, mv";
const POWERSHELL_FORBIDDEN = "New-Item, Remove-Item, Copy-Item, Move-Item";
const SHARED_FORBIDDEN =
  "git add, git commit, npm install, pip install, or any file creation/modification";

function searchBullets(kind: ShellKindChoice): string[] {
  if (kind === "bash") {
    return [
      `- Use \`find\` in ${BASH_TOOL_NAME} for file-name and path matching (e.g. \`find . -name '*.tsx'\`)`,
      `- Use \`grep -rn\` in ${BASH_TOOL_NAME} for file contents — it already honours .gitignore and skips binary files`,
    ];
  }
  // Without bash the shadows do not exist and the registry puts the tools back
  // (`shouldRegisterSearchTools`), which is the pair Claude Code names here in
  // the same situation.
  return [
    `- Use ${GLOB_TOOL_NAME} for broad file pattern matching`,
    `- Use ${GREP_TOOL_NAME} for searching file contents with regex`,
  ];
}

function searchInline(kind: ShellKindChoice): string {
  return kind === "bash"
    ? `\`find\` / \`grep\` in ${BASH_TOOL_NAME} and ${READ_TOOL_NAME}`
    : `${GLOB_TOOL_NAME} / ${GREP_TOOL_NAME} and ${READ_TOOL_NAME}`;
}

function restrictions(kind: ShellKindChoice): string[] {
  if (kind === "bash") {
    return [
      `- Use ${BASH_TOOL_NAME} ONLY for read-only operations (${BASH_READ_ONLY})`,
      `- NEVER use ${BASH_TOOL_NAME} for: ${BASH_FORBIDDEN}, ${SHARED_FORBIDDEN}`,
    ];
  }
  if (kind === "powershell") {
    return [
      `- Use ${POWERSHELL_TOOL_NAME} ONLY for read-only operations (${POWERSHELL_READ_ONLY})`,
      `- NEVER use ${POWERSHELL_TOOL_NAME} for: ${POWERSHELL_FORBIDDEN}, ${SHARED_FORBIDDEN}`,
    ];
  }
  // Wave-only state (Claude Code exits at startup instead): say that there is
  // no shell rather than naming one that is not registered.
  return [
    "- This session has no shell tool (Git Bash was not found and the PowerShell tool is off), so shell commands cannot run — use the file and search tools instead",
  ];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace a token that occupies a whole line, keeping the line's indentation on
 * every line it expands to (Plan's bullets sit inside a numbered section).
 */
function replaceLineToken(
  text: string,
  token: string,
  lines: string[],
): string {
  const pattern = new RegExp(`^([ \\t]*)${escapeRegExp(token)}[ \\t]*$`, "gm");
  return text.replace(pattern, (_match, indent: string) =>
    lines.map((line) => `${indent}${line}`).join("\n"),
  );
}

/** Resolve the shell-dependent lines of `text` for a session running `kind`. */
export function renderShellGuidance(
  text: string,
  kind: ShellKindChoice,
): string {
  const withSearch = replaceLineToken(
    text.split(SHELL_SEARCH_INLINE_TOKEN).join(searchInline(kind)),
    SHELL_SEARCH_BULLETS_TOKEN,
    searchBullets(kind),
  );
  return replaceLineToken(
    withSearch,
    SHELL_RESTRICTIONS_TOKEN,
    restrictions(kind),
  );
}
