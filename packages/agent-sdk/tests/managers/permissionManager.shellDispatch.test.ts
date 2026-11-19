/**
 * P2 guardrail: permissions dispatch on the shell *kind* carried by the
 * context, not on the tool name.
 *
 * The PowerShell tool does not exist yet, so every real context is bash. These
 * cases pin what happens to a context that says otherwise: it must fall through
 * to the generic ask, never be split with bash syntax and never be authorized
 * by a `Bash(…)` rule.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { Container } from "../../src/utils/container.js";
import type { ToolPermissionContext } from "../../src/types/permissions.js";
import type { ConfigurationService } from "../../src/services/configurationService.js";
import {
  BASH_TOOL_NAME,
  POWERSHELL_TOOL_NAME,
} from "../../src/constants/tools.js";
import { parsePowerShellCommand } from "../../src/utils/powershellStructure/psParser.js";
import type { ParsedPowerShellCommand } from "../../src/utils/powershellStructure/types.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * The real parser spawns `pwsh`, so a unit test must not depend on whether the
 * runner has one. The default is a failed parse — the engine's fail-closed
 * "ask", which is how a fake PowerShell context is judged anyway — and the
 * persistence cases below install the parse they need.
 */
vi.mock(
  "../../src/utils/powershellStructure/psParser.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/utils/powershellStructure/psParser.js")
      >();
    return {
      ...actual,
      parsePowerShellCommand: vi.fn(
        async (command: string): Promise<ParsedPowerShellCommand> => ({
          valid: false,
          errors: [{ errorId: "NoPowerShell", message: "stubbed in tests" }],
          statements: [],
          variables: [],
          hasStopParsing: false,
          originalCommand: command,
        }),
      ),
    };
  },
);

const WORKDIR = "/fake/project";

function createManager(): {
  manager: PermissionManager;
  configurationService: { addAllowedRule: ReturnType<typeof vi.fn> };
} {
  const container = new Container();
  container.register("CurrentWorkdir", WORKDIR);
  const configurationService = {
    addAllowedRule: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConfigurationService;
  container.register("ConfigurationService", configurationService);
  return {
    manager: new PermissionManager(container),
    configurationService: configurationService as unknown as {
      addAllowedRule: ReturnType<typeof vi.fn>;
    },
  };
}

/**
 * A restricted context that claims to be driven by PowerShell.
 *
 * `toolName` stays `Bash` because the PowerShell tool is not registered (and so
 * not restricted) until it exists; the kind is what is under test.
 */
function powershellContext(
  manager: PermissionManager,
  command: string,
): ToolPermissionContext {
  return {
    ...manager.createContext(BASH_TOOL_NAME, "default", undefined, {
      command,
      workdir: WORKDIR,
    }),
    shellKind: "powershell",
  };
}

describe("PermissionManager - shell kind dispatch", () => {
  let manager: PermissionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createManager().manager;
  });

  describe("createContext", () => {
    it("derives the shell kind from the tool name", () => {
      expect(manager.createContext(BASH_TOOL_NAME, "default").shellKind).toBe(
        "bash",
      );
      expect(
        manager.createContext(POWERSHELL_TOOL_NAME, "default").shellKind,
      ).toBe("powershell");
    });

    it("leaves the kind unset for tools that are not shell tools", () => {
      expect(
        manager.createContext("Edit", "default").shellKind,
      ).toBeUndefined();
    });

    it("ignores a shell kind smuggled in through tool input", () => {
      // Tool input comes from the model; letting it pick the shell would let it
      // pick the rule set that judges the call.
      const context = manager.createContext(
        BASH_TOOL_NAME,
        "default",
        undefined,
        { command: "ls", shellKind: "powershell" },
      );

      expect(context.shellKind).toBe("bash");
    });
  });

  describe("a bash-kind context keeps the existing behaviour", () => {
    it("auto-allows a read-only command", async () => {
      const context = manager.createContext(
        BASH_TOOL_NAME,
        "default",
        undefined,
        {
          command: "ls",
          workdir: WORKDIR,
        },
      );

      expect(await manager.checkPermission(context)).toEqual({
        behavior: "allow",
      });
    });

    it("suggests a prefix for a single command", () => {
      const context = manager.createContext(
        BASH_TOOL_NAME,
        "default",
        undefined,
        {
          command: "npm test",
          workdir: WORKDIR,
        },
      );

      expect(context.suggestedPrefix).toBe("npm test");
    });
  });

  describe("a powershell-kind context is never judged as bash", () => {
    it("is not auto-allowed by the built-in read-only rules", async () => {
      const result = await manager.checkPermission(
        powershellContext(manager, "ls"),
      );

      expect(result.behavior).toBe("deny");
      expect(result.message).toContain("requires permission approval");
    });

    it("is not authorized by an explicit Bash rule", async () => {
      manager.updateAllowedRules(["Bash(ls*)"]);

      const result = await manager.checkPermission(
        powershellContext(manager, "ls"),
      );

      expect(result.behavior).toBe("deny");
    });

    it("gets no bash prefix suggestion and no bash persistence heuristics", () => {
      const context = manager.createContext(
        POWERSHELL_TOOL_NAME,
        "default",
        undefined,
        { command: "rm -rf /", workdir: WORKDIR },
      );

      expect(context.suggestedPrefix).toBeUndefined();
      expect(context.hidePersistentOption).toBeUndefined();
    });

    it("still hides persistence for the equivalent bash command", () => {
      const context = manager.createContext(
        BASH_TOOL_NAME,
        "default",
        undefined,
        { command: "rm -rf /", workdir: WORKDIR },
      );

      expect(context.hidePersistentOption).toBe(true);
    });
  });

  describe("persisted rules expand per shell", () => {
    it("expands a Bash rule with bash syntax (unchanged)", async () => {
      const { manager: fresh, configurationService } = createManager();

      await fresh.addPermissionRule("Bash(npm test)");

      expect(configurationService.addAllowedRule).toHaveBeenCalledWith(
        WORKDIR,
        "Bash(npm test*)",
      );
    });

    it("expands a PowerShell rule through its own parser, not bash", async () => {
      // Bash would derive the wildcard `Bash(Get-ChildItem*)` from this text.
      // PowerShell has no prefix rule: the leaf text *is* the rule, and a
      // pipeline yields one rule per leaf (a rule carrying `|` matches no leaf,
      // see `permissionManager.powershell.test.ts`).
      vi.mocked(parsePowerShellCommand).mockResolvedValueOnce({
        valid: true,
        errors: [],
        statements: [
          {
            statementType: "PipelineAst",
            commands: [
              {
                name: "Get-ChildItem",
                nameType: "cmdlet",
                elementType: "CommandAst",
                args: ["-Recurse", "."],
                text: "Get-ChildItem -Recurse .",
                elementTypes: [
                  "StringConstant",
                  "StringConstant",
                  "StringConstant",
                ],
              },
            ],
            redirections: [],
            text: "Get-ChildItem -Recurse .",
          },
        ],
        variables: [],
        hasStopParsing: false,
        originalCommand: "Get-ChildItem -Recurse .",
      });
      const { manager: fresh, configurationService } = createManager();

      await fresh.addPermissionRule("PowerShell(Get-ChildItem -Recurse .)");

      expect(configurationService.addAllowedRule).toHaveBeenCalledTimes(1);
      expect(configurationService.addAllowedRule).toHaveBeenCalledWith(
        WORKDIR,
        "PowerShell(Get-ChildItem -Recurse .)",
      );
    });

    it("does not treat a non-shell rule that looks similar as a shell rule", async () => {
      const { manager: fresh, configurationService } = createManager();

      await fresh.addPermissionRule("Bashrc(npm test)");

      expect(configurationService.addAllowedRule).toHaveBeenCalledWith(
        WORKDIR,
        "Bashrc(npm test)",
      );
    });
  });
});
