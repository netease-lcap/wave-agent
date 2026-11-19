import { describe, it, expect, vi, beforeEach } from "vitest";
import { powershellPrompt } from "../../../src/tools/powershellTool/prompt.js";
import { getPowerShellEdition } from "../../../src/utils/shell/powershellDetection.js";
import type { ToolPromptArgs } from "../../../src/tools/types.js";

vi.mock("../../../src/utils/shell/powershellDetection.js", () => ({
  getPowerShellEdition: vi.fn(),
}));

function args(availableTools: string[]): ToolPromptArgs {
  return { availableTools } as ToolPromptArgs;
}

/** The edition bullets only — the rest of the prompt is edition-independent. */
function editionPart(prompt: string): string {
  const start = prompt.indexOf("PowerShell edition:");
  return prompt.slice(start, prompt.indexOf("\n\n", start));
}

describe("powershellPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("edition fork", () => {
    it("tells a PowerShell 7 session that && behaves like bash", () => {
      vi.mocked(getPowerShellEdition).mockReturnValue("core");

      const edition = editionPart(powershellPrompt());

      expect(edition).toContain("PowerShell 7+");
      expect(edition).toContain("`&&` and `||` ARE available");
      // 7 defaults to UTF-8, so 5.1's encoding rules must not leak in here.
      expect(edition).not.toContain("UTF-16");
      expect(edition).not.toContain("NOT available");
    });

    it("tells a 5.1 session that && is NOT available", () => {
      vi.mocked(getPowerShellEdition).mockReturnValue("desktop");

      const edition = editionPart(powershellPrompt());

      expect(edition).toContain("Windows PowerShell 5.1");
      expect(edition).toContain("`&&` and `||` are NOT available");
      expect(edition).toContain("`A; if ($?) { B }`");
      // The 2>&1 trap is a 5.1 parser quirk; saying it there is the point.
      expect(edition).toContain("NativeCommandError");
      expect(edition).toContain("-Encoding utf8");
    });

    it("falls back to the conservative 5.1 rules when the edition is unknown", () => {
      vi.mocked(getPowerShellEdition).mockReturnValue(undefined);

      const edition = editionPart(powershellPrompt());

      expect(edition).toContain("unknown");
      expect(edition).toContain("parse-error on 5.1");
    });
  });

  describe("CC's unix → PowerShell table", () => {
    /** Every entry, verbatim from CC (binary `@343205396`). */
    const ENTRIES = [
      "- head / tail → `Get-Content file -TotalCount N` / `-Tail N`; piped: `| Select-Object -First N` / `-Last N`",
      "- which → `(Get-Command name).Source`",
      "- touch → `if (-not (Test-Path path)) { New-Item -ItemType File path }` (NEVER use `New-Item -Force` on a file — it truncates existing content)",
      "- wc -l → `(Get-Content file | Measure-Object -Line).Lines`",
      "- mkdir -p → `New-Item -ItemType Directory -Force path` (`-p` is not a PowerShell flag)",
      "- rm -rf → `Remove-Item -Recurse -Force path`",
      "- ln -s → `New-Item -ItemType SymbolicLink -Path link -Target target`",
      "- chmod / chown → not applicable on Windows; use `icacls` only if ACL changes are required",
      "- 2>/dev/null → `2>$null` (but stderr is captured for you — usually unnecessary)",
      "- VAR=x cmd → `$env:VAR = 'x'; cmd` (PowerShell has no inline env-var prefix)",
      "- Bash control flow (`if [ -f x ]`, `for x in *`, backtick ``cmd`` substitution) is a parser error — use `if (Test-Path x)`, `foreach ($x in ...)`, `$(cmd)`",
    ];

    it("carries the heading and all eleven mappings", () => {
      vi.mocked(getPowerShellEdition).mockReturnValue("desktop");

      const prompt = powershellPrompt();

      expect(prompt).toContain(
        "Unix commands that DO NOT exist in PowerShell — use the equivalent instead:",
      );
      for (const entry of ENTRIES) {
        expect(prompt).toContain(entry);
      }
    });

    it("is edition-independent, like CC's (it sits outside the edition branch)", () => {
      const render = (edition: "core" | "desktop" | undefined) => {
        vi.mocked(getPowerShellEdition).mockReturnValue(edition);
        const prompt = powershellPrompt();
        return prompt.slice(
          prompt.indexOf("Unix commands that DO NOT exist"),
          prompt.indexOf("Interactive and blocking commands"),
        );
      };

      const core = render("core");
      expect(render("desktop")).toBe(core);
      expect(render(undefined)).toBe(core);
    });

    it("maps each bash idiom in exactly one place", () => {
      vi.mocked(getPowerShellEdition).mockReturnValue("desktop");

      const prompt = powershellPrompt();
      const occurrences = (needle: string) => prompt.split(needle).length - 1;

      // `2>/dev/null` used to be described a second time under "Bash habits";
      // the table is now the only copy, and `VAR=x cmd` moved here out of the
      // environment-variable bullet.
      expect(occurrences("2>/dev/null →")).toBe(1);
      expect(occurrences("VAR=x cmd")).toBe(1);
      expect(occurrences("Bash habits that do not carry over")).toBe(0);
    });

    it("adds the exit-code note about -ErrorAction SilentlyContinue", () => {
      vi.mocked(getPowerShellEdition).mockReturnValue("desktop");

      const prompt = powershellPrompt();

      expect(prompt).toContain("Exit-code note:");
      expect(prompt).toContain(
        "suppresses error OUTPUT but the cmdlet failure still causes this tool to report exit 1",
      );
      // The recipe needs a statement in `catch`: an empty block does not reset
      // `$?`, so `catch {}` still reported exit 1 (measured on PowerShell 5.1).
      expect(prompt).toContain(
        "try { Cmdlet ... -ErrorAction Stop } catch { $null }",
      );
      expect(prompt).toContain("the `catch` block may not be left empty");
      // Regression guard — no empty catch block anywhere in the description.
      expect(prompt.match(/catch\s*\{\s*\}/g) ?? []).toEqual([]);
    });
  });

  describe("heredoc → here-string", () => {
    it("spells out the here-string closing rule with an example", () => {
      vi.mocked(getPowerShellEdition).mockReturnValue("desktop");

      const prompt = powershellPrompt();

      expect(prompt).toContain("MUST sit at column 0");
      expect(prompt).toContain("git commit -m @'");
      expect(prompt).toContain("'@");
    });
  });

  describe("interactive commands are banned", () => {
    it("names every command that would block a -NonInteractive process", () => {
      vi.mocked(getPowerShellEdition).mockReturnValue("desktop");

      const prompt = powershellPrompt();

      for (const banned of [
        "Read-Host",
        "Get-Credential",
        "Out-GridView",
        "pause",
      ]) {
        expect(prompt).toContain(banned);
      }
      expect(prompt).toContain("-Confirm:$false");
      expect(prompt).toContain("git rebase -i");
    });
  });

  describe("dedicated tools", () => {
    it("points at Grep and Glob when the session has them", () => {
      vi.mocked(getPowerShellEdition).mockReturnValue("desktop");

      const prompt = powershellPrompt(args(["Grep", "Glob", "Read"]));

      expect(prompt).toContain("Use Glob (NOT `Get-ChildItem -Recurse`)");
      expect(prompt).toContain("Use Grep (NOT `Select-String`)");
    });

    it("points back at the shell when the search tools are absent", () => {
      vi.mocked(getPowerShellEdition).mockReturnValue("desktop");

      const prompt = powershellPrompt(args(["Read"]));

      expect(prompt).toContain("this session has no Glob tool");
      expect(prompt).toContain("this session has no Grep tool");
      expect(prompt).not.toContain("Use Grep (NOT");
    });
  });

  it("does not tell the model to report the exit code by hand", () => {
    vi.mocked(getPowerShellEdition).mockReturnValue("desktop");

    // The provider appends the probe; a paragraph here would be stale advice.
    expect(powershellPrompt()).not.toContain("LASTEXITCODE");
  });

  describe("background tasks", () => {
    it("offers run_in_background the way CC's note does", () => {
      vi.mocked(getPowerShellEdition).mockReturnValue("desktop");

      const prompt = powershellPrompt();

      expect(prompt).toContain("`run_in_background` parameter");
      expect(prompt).toContain("you'll be notified when it finishes");
      expect(prompt).not.toContain("CLAUDE_CODE_DISABLE_BACKGROUND_TASKS");
    });

    it("says Start-Sleep, not sleep, because there is no bash here", () => {
      vi.mocked(getPowerShellEdition).mockReturnValue("desktop");

      const prompt = powershellPrompt();

      expect(prompt).toContain("# Avoid unnecessary sleep commands");
      expect(prompt).toContain("Do not `Start-Sleep` between commands");
      expect(prompt).toContain("diagnose the root cause");
      expect(prompt).toContain("keep the duration short (1-5 seconds)");
    });
  });
});
