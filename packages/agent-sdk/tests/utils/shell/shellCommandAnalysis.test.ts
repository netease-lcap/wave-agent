import { describe, it, expect } from "vitest";
import { analyzeShellCommand } from "../../../src/utils/shell/shellCommandAnalysis.js";

describe("analyzeShellCommand", () => {
  it("cuts a bash command into its leaf commands", () => {
    const analysis = analyzeShellCommand("bash", "cd src && npm test");

    expect(analysis.status).toBe("ok");
    if (analysis.status !== "ok") return;
    expect(analysis.leaves.map((leaf) => leaf.text)).toEqual([
      "cd src",
      "npm test",
    ]);
  });

  it("delegates bash's own fail-closed constructs unchanged", () => {
    const analysis = analyzeShellCommand("bash", "cat <<EOF\nhi\nEOF");

    expect(analysis.status).toBe("unsupported");
    if (analysis.status !== "unsupported") return;
    expect(analysis.reason).toBe("heredoc");
  });

  it("fails closed for a shell without a parser instead of guessing", () => {
    const analysis = analyzeShellCommand(
      "powershell",
      "Get-ChildItem | Remove-Item",
    );

    expect(analysis.status).toBe("unsupported");
    if (analysis.status !== "unsupported") return;
    expect(analysis.reason).toBe("no-parser");
    expect(analysis.message).toContain("powershell");
  });
});
