/**
 * Which permission namespace an injected command is judged in.
 *
 * Rules live per tool (`Bash(cmd:*)` vs `PowerShell(cmd:*)`), so a gate that
 * always says `Bash` would judge a PowerShell session's command against rules
 * written for another shell — deny it for the wrong reason, or let a `Bash(...)`
 * allow rule vouch for a command the PowerShell tool then parses differently.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Container } from "../../src/utils/container.js";
import { createBashCommandGate } from "../../src/utils/bashCommandGate.js";
import {
  BASH_TOOL_NAME,
  POWERSHELL_TOOL_NAME,
} from "../../src/constants/tools.js";

// Only the gate inputs are stubbed — the wiring under test picks the tool name.
const gateInput = vi.hoisted(() => ({
  current: {
    platform: "win32" as NodeJS.Platform,
    envValue: undefined as string | undefined,
    hasGitBash: true,
  },
}));

vi.mock("../../src/utils/shell/shellToolGate.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/utils/shell/shellToolGate.js")
    >();
  return {
    ...actual,
    collectShellToolGateInput: () => gateInput.current,
  };
});

const createPermissionManager = () => ({
  getCurrentEffectiveMode: () => "default",
  createContext: vi.fn(
    (
      toolName: string,
      mode: string,
      callback: unknown,
      input: { command: string; workdir: string },
    ) => ({ toolName, mode, callback, input }),
  ),
  checkPermission: vi.fn(),
});

const createContainer = (
  permissionManager: ReturnType<typeof createPermissionManager>,
) =>
  ({
    has: (key: string) => key === "PermissionManager",
    get: () => permissionManager,
  }) as unknown as Container;

describe("createBashCommandGate", () => {
  beforeEach(() => {
    gateInput.current = {
      platform: "win32",
      envValue: undefined,
      hasGitBash: true,
    };
  });

  it("judges with the Bash tool name when the session runs bash", async () => {
    const permissionManager = createPermissionManager();
    permissionManager.checkPermission.mockResolvedValue({ behavior: "allow" });
    const gate = createBashCommandGate(createContainer(permissionManager));

    await gate!.check("gh pr view", "/work");

    expect(permissionManager.createContext).toHaveBeenCalledWith(
      BASH_TOOL_NAME,
      "default",
      undefined,
      { command: "gh pr view", workdir: "/work" },
    );
  });

  it("judges with the PowerShell tool name when the session runs PowerShell", async () => {
    gateInput.current = { platform: "win32", envValue: "1", hasGitBash: true };
    const permissionManager = createPermissionManager();
    permissionManager.checkPermission.mockResolvedValue({ behavior: "allow" });
    const gate = createBashCommandGate(createContainer(permissionManager));

    await gate!.check("Get-ChildItem", "/work");

    expect(permissionManager.createContext).toHaveBeenCalledWith(
      POWERSHELL_TOOL_NAME,
      "default",
      undefined,
      { command: "Get-ChildItem", workdir: "/work" },
    );
  });

  it("turns anything but 'allow' into a deny carrying the rule's message", async () => {
    const permissionManager = createPermissionManager();
    permissionManager.checkPermission.mockResolvedValue({
      behavior: "deny",
      message: "blocked by rule",
    });
    const gate = createBashCommandGate(createContainer(permissionManager));

    await expect(gate!.check("rm -rf /", "/work")).resolves.toEqual({
      behavior: "deny",
      message: "blocked by rule",
    });
  });

  it("returns no gate when there is no permission manager to ask", () => {
    const gate = createBashCommandGate({
      has: () => false,
      get: () => undefined,
    } as unknown as Container);

    expect(gate).toBeUndefined();
  });
});
