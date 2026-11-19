/**
 * The shell-dependent lines of the builtin Explore / Plan prompts.
 *
 * Claude Code forks these on "is bash available" (`_c()` @322404104; Explore
 * @324941020, Plan @324944960): tool name, read-only verb list and forbidden
 * verb list all change. Wave keeps the prompt in markdown, so the fork has to
 * happen when a session parses it — these tests pin both halves of that.
 */

import { describe, expect, it } from "vitest";
import { subagents } from "../../src/builtin/subagents.js";
import {
  renderShellGuidance,
  SHELL_RESTRICTIONS_TOKEN,
  SHELL_SEARCH_BULLETS_TOKEN,
  SHELL_SEARCH_INLINE_TOKEN,
} from "../../src/utils/shellPromptGuidance.js";

const explore = subagents["subagents/explore.md"];
const plan = subagents["subagents/plan.md"];

describe("renderShellGuidance", () => {
  it("renders an empty placeholder set as a no-op", () => {
    const text = "No placeholders here.";

    expect(renderShellGuidance(text, "bash")).toBe(text);
  });

  it("keeps a line token's indentation on every line it expands to", () => {
    const rendered = renderShellGuidance(
      "Section:\n   {{WAVE_SHELL_RESTRICTIONS}}\n",
      "powershell",
    );

    expect(rendered.split("\n")[1]).toMatch(/^ {3}- Use PowerShell ONLY/);
    expect(rendered.split("\n")[2]).toMatch(/^ {3}- NEVER use PowerShell for:/);
  });

  it("replaces an inline token inside a sentence", () => {
    const rendered = renderShellGuidance(
      "using {{WAVE_SHELL_SEARCH_INLINE}} to look around",
      "powershell",
    );

    expect(rendered).toBe("using Glob / Grep and Read to look around");
  });
});

describe("Explore / Plan prompt, by session shell", () => {
  it("names Bash and its own read-only verbs when the session runs bash", () => {
    const rendered = renderShellGuidance(explore, "bash");

    expect(rendered).toContain("- Use `find` in Bash for file-name and path");
    expect(rendered).toContain("- Use `grep -rn` in Bash for file contents");
    expect(rendered).toContain(
      "- Use Bash ONLY for read-only operations (ls, git status, git log, git diff, find, cat, head, tail)",
    );
    expect(rendered).toContain(
      "- NEVER use Bash for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install, or any file creation/modification",
    );
    expect(rendered).not.toContain("PowerShell");
  });

  it("names PowerShell and its own verbs when there is no Git Bash", () => {
    const rendered = renderShellGuidance(explore, "powershell");

    expect(rendered).toContain("- Use Glob for broad file pattern matching");
    expect(rendered).toContain(
      "- Use Grep for searching file contents with regex",
    );
    expect(rendered).toContain(
      "- Use PowerShell ONLY for read-only operations (Get-ChildItem, git status, git log, git diff, Get-Content, Select-Object -First/-Last)",
    );
    expect(rendered).toContain(
      "- NEVER use PowerShell for: New-Item, Remove-Item, Copy-Item, Move-Item, git add, git commit, npm install, pip install, or any file creation/modification",
    );
    // The bash-only verbs must be gone, not merely renamed: neither `find` /
    // `grep` nor the bash removal commands exist in PowerShell.
    expect(rendered).not.toContain("mkdir, touch");
    expect(rendered).not.toContain("in Bash for file-name");
  });

  it("says there is no shell at all when the session has neither", () => {
    const rendered = renderShellGuidance(explore, "none");

    expect(rendered).toContain(
      "- This session has no shell tool (Git Bash was not found and the PowerShell tool is off), so shell commands cannot run — use the file and search tools instead",
    );
    expect(rendered).not.toContain("ONLY for read-only operations");
    expect(rendered).not.toContain("NEVER use");
  });

  it("renders Plan's inline search line for both shells", () => {
    expect(renderShellGuidance(plan, "bash")).toContain(
      "Find existing patterns and conventions using `find` / `grep` in Bash and Read",
    );
    expect(renderShellGuidance(plan, "powershell")).toContain(
      "Find existing patterns and conventions using Glob / Grep and Read",
    );
  });

  it("leaves no placeholder behind in any state", () => {
    for (const kind of ["bash", "powershell", "none"] as const) {
      for (const text of [explore, plan]) {
        expect(renderShellGuidance(text, kind)).not.toMatch(/\{\{WAVE_/);
      }
    }
  });

  it("keeps the placeholders in the builtin content until a session resolves them", () => {
    expect(explore).toContain(SHELL_SEARCH_BULLETS_TOKEN);
    expect(explore).toContain(SHELL_RESTRICTIONS_TOKEN);
    expect(plan).toContain(SHELL_SEARCH_INLINE_TOKEN);
    expect(plan).toContain(SHELL_RESTRICTIONS_TOKEN);
  });
});
