import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  powershellLeanPrompt,
  powershellPrompt,
} from "../../../src/tools/powershellTool/prompt.js";
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

  describe("bash habits mapped to PowerShell", () => {
    it("maps the three idioms that silently do the wrong thing", () => {
      vi.mocked(getPowerShellEdition).mockReturnValue("desktop");

      const prompt = powershellPrompt();

      expect(prompt).toContain("`cmd 2>/dev/null || true`");
      expect(prompt).toContain("2>$null; if (-not $?)");
      expect(prompt).toContain("heredoc `<<'EOF'`");
      expect(prompt).toContain("`cmd1 && cmd2`");
    });

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
    expect(powershellLeanPrompt()).not.toContain("LASTEXITCODE");
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

    it("mentions run_in_background once in the lean prompt too", () => {
      vi.mocked(getPowerShellEdition).mockReturnValue("desktop");

      expect(powershellLeanPrompt()).toContain("`run_in_background`");
    });
  });
});

describe("powershellLeanPrompt", () => {
  it("carries the edition limit but not the long-form guidance", () => {
    vi.mocked(getPowerShellEdition).mockReturnValue("desktop");

    const lean = powershellLeanPrompt();

    expect(lean).toContain("Windows PowerShell 5.1");
    expect(lean).toContain("one PowerShell command");
    expect(lean.length).toBeLessThan(powershellPrompt().length / 4);
  });

  it("says && works on PowerShell 7", () => {
    vi.mocked(getPowerShellEdition).mockReturnValue("core");

    expect(powershellLeanPrompt()).toContain("`&&` / `||` work like bash");
  });
});
