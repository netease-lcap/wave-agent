import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { POWERSHELL_TOOL_NAME } from "../../src/constants/tools.js";
import type { PermissionCallback } from "../../src/types/permissions.js";
import { Container } from "../../src/utils/container.js";
import { parsePowerShellCommand } from "../../src/utils/powershellStructure/psParser.js";
import type {
  ParsedCommandElement,
  ParsedPowerShellCommand,
} from "../../src/utils/powershellStructure/types.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/utils/powershellStructure/psParser.js", () => ({
  parsePowerShellCommand: vi.fn(),
}));

const WORKDIR = "/work/project";

function leaf(name: string, args: string[] = []): ParsedCommandElement {
  return {
    name,
    nameType: "unknown",
    elementType: "CommandAst",
    args,
    text: [name, ...args].join(" "),
    elementTypes: [name, ...args].map(() => "StringConstant"),
  };
}

function mockParse(...commands: ParsedCommandElement[]) {
  const parsed: ParsedPowerShellCommand = {
    valid: true,
    errors: [],
    statements: [
      {
        statementType: "PipelineAst",
        commands,
        redirections: [],
        text: commands.map((command) => command.text).join(" | "),
      },
    ],
    variables: [],
    hasStopParsing: false,
    originalCommand: commands.map((command) => command.text).join(" | "),
  };
  vi.mocked(parsePowerShellCommand).mockResolvedValue(parsed);
}

function createManager() {
  const container = new Container();
  container.register("CurrentWorkdir", WORKDIR);
  return new PermissionManager(container);
}

describe("PermissionManager — PowerShell branch", () => {
  let manager: PermissionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createManager();
    mockParse(leaf("Get-ChildItem", ["src"]));
  });

  it("should derive the shell kind from the tool name", () => {
    const context = manager.createContext(
      POWERSHELL_TOOL_NAME,
      "default",
      undefined,
      {
        command: "Get-ChildItem src",
      },
    );
    expect(context.shellKind).toBe("powershell");
  });

  it("should allow a read-only command without asking", async () => {
    const callback = vi.fn<PermissionCallback>();
    const context = manager.createContext(
      POWERSHELL_TOOL_NAME,
      "default",
      callback,
      {
        command: "Get-ChildItem src",
        workdir: WORKDIR,
      },
    );

    const result = await manager.checkPermission(context);

    expect(result.behavior).toBe("allow");
    expect(callback).not.toHaveBeenCalled();
  });

  it("should deny by a PowerShell deny rule", async () => {
    manager.updateDeniedRules(["PowerShell(iex*)"]);
    const context = manager.createContext(
      POWERSHELL_TOOL_NAME,
      "default",
      undefined,
      {
        command: "iex 'evil'",
        workdir: WORKDIR,
      },
    );

    const result = await manager.checkPermission(context);

    expect(result.behavior).toBe("deny");
    expect(result.message).toContain("iex*");
  });

  it("should carry the suggested prefix into the prompt", async () => {
    mockParse(leaf("Set-Content", ["-Path", "a.txt", "-Value", "x"]));
    const callback = vi.fn<PermissionCallback>(async () => ({
      behavior: "allow",
    }));
    const context = manager.createContext(
      POWERSHELL_TOOL_NAME,
      "default",
      callback,
      {
        command: "Set-Content -Path a.txt -Value x",
        workdir: WORKDIR,
      },
    );

    const result = await manager.checkPermission(context);

    expect(result.behavior).toBe("allow");
    expect(callback).toHaveBeenCalledTimes(1);
    const asked = vi.mocked(callback).mock.calls[0]![0];
    // `Set-Content` is destructive: the prompt must not offer a permanent rule.
    expect(asked.hidePersistentOption).toBe(true);
    expect(asked.suggestedPrefix).toBeUndefined();
  });

  it("should still deny an ask-worthy command in dontAsk mode", async () => {
    mockParse(leaf("Set-Content", ["-Path", "a.txt", "-Value", "x"]));
    const context = manager.createContext(
      POWERSHELL_TOOL_NAME,
      "dontAsk",
      undefined,
      {
        command: "Set-Content -Path a.txt -Value x",
        workdir: WORKDIR,
      },
    );

    const result = await manager.checkPermission(context);

    expect(result.behavior).toBe("deny");
  });

  it("should not let a bash allow rule cover a PowerShell command", async () => {
    manager.updateAllowedRules(["Bash(Get-ChildItem*)"]);
    mockParse(leaf("Set-Content", ["-Path", "a.txt", "-Value", "x"]));
    const callback = vi.fn<PermissionCallback>(async () => ({
      behavior: "deny",
      message: "no",
    }));
    const context = manager.createContext(
      POWERSHELL_TOOL_NAME,
      "default",
      callback,
      {
        command: "Set-Content -Path a.txt -Value x",
        workdir: WORKDIR,
      },
    );

    const result = await manager.checkPermission(context);

    expect(result.behavior).toBe("deny");
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
