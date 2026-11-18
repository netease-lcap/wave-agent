import { describe, it, expect } from "vitest";
import {
  BASH_TOOL_NAME,
  POWERSHELL_TOOL_NAME,
  SHELL_TOOL_NAMES,
  isShellToolName,
  shellKindOfTool,
} from "../../src/constants/tools.js";

describe("shell tool names", () => {
  it("recognises exactly the tools that run a command through a shell", () => {
    expect(isShellToolName(BASH_TOOL_NAME)).toBe(true);
    expect(isShellToolName(POWERSHELL_TOOL_NAME)).toBe(true);
  });

  it("rejects every other tool, including look-alikes", () => {
    for (const name of [
      "Edit",
      "Read",
      "Grep",
      "bash",
      "Bash ",
      "Bashx",
      "powershell",
      "PowerShellTool",
      "",
    ]) {
      expect(isShellToolName(name)).toBe(false);
      expect(shellKindOfTool(name)).toBeUndefined();
    }
  });

  it("maps each shell tool to its shell kind", () => {
    expect(shellKindOfTool(BASH_TOOL_NAME)).toBe("bash");
    expect(shellKindOfTool(POWERSHELL_TOOL_NAME)).toBe("powershell");
  });

  it("lists the names without duplicates", () => {
    expect(SHELL_TOOL_NAMES).toEqual([BASH_TOOL_NAME, POWERSHELL_TOOL_NAME]);
    expect(new Set(SHELL_TOOL_NAMES).size).toBe(SHELL_TOOL_NAMES.length);
  });
});
