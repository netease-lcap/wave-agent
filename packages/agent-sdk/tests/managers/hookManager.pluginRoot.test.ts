import { describe, it, expect, beforeEach, vi } from "vitest";
import { HookManager } from "../../src/managers/hookManager.js";
import { Container } from "../../src/utils/container.js";
import { HookMatcher } from "../../src/utils/hookMatcher.js";
import * as hookService from "../../src/services/hook.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the hook services
vi.mock("../../src/services/hook.js", async () => {
  const actual = (await vi.importActual(
    "../../src/services/hook.js",
  )) as Record<string, unknown>;
  return {
    ...actual,
    executeCommand: vi.fn(),
    isCommandSafe: vi.fn().mockReturnValue(true),
  };
});
const mockExecuteCommand = vi.mocked(hookService.executeCommand);

describe("HookManager pluginRoot handling and plugin hook registration", () => {
  let manager: HookManager;
  let mockMatcher: HookMatcher;

  beforeEach(() => {
    mockMatcher = new HookMatcher();

    const container = new Container();

    manager = new HookManager(container, "/test/workdir", mockMatcher);
    mockExecuteCommand.mockResolvedValue({
      success: true,
      duration: 100,
      timedOut: false,
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    vi.clearAllMocks();
  });

  describe("registerPluginHooks", () => {
    it("should initialize configuration if it doesn't exist", () => {
      manager.registerPluginHooks("/test/plugin", {
        UserPromptSubmit: [
          {
            hooks: [{ type: "command" as const, command: "echo plugin-hook" }],
          },
        ],
      });
      expect(manager.getConfiguration()?.UserPromptSubmit).toHaveLength(1);
    });

    it("should stamp pluginRoot on hook commands", () => {
      manager.registerPluginHooks("/my/plugin/root", {
        PreToolUse: [
          {
            hooks: [{ type: "command" as const, command: "echo test" }],
          },
        ],
      });
      const config = manager.getConfiguration();
      const hook = config?.PreToolUse?.[0]?.hooks?.[0];
      expect(hook?.pluginRoot).toBe("/my/plugin/root");
    });

    it("should pass WAVE_PLUGIN_ROOT in env to executeCommand for plugin hooks", async () => {
      manager.registerPluginHooks("/my/plugin/root", {
        UserPromptSubmit: [
          {
            hooks: [{ type: "command" as const, command: "echo plugin" }],
          },
        ],
      });

      const context = {
        event: "UserPromptSubmit" as const,
        projectDir: "/test/workdir",
        timestamp: new Date(),
      };

      await manager.executeHooks("UserPromptSubmit", context);

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "echo plugin",
        expect.objectContaining({
          env: expect.objectContaining({
            WAVE_PLUGIN_ROOT: "/my/plugin/root",
          }),
        }),
        undefined,
      );
    });

    it("should substitute ${WAVE_PLUGIN_ROOT} in plugin hook command string", async () => {
      manager.registerPluginHooks("/my/plugin/root", {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command" as const,
                command: "${WAVE_PLUGIN_ROOT}/scripts/hook.sh",
              },
            ],
          },
        ],
      });

      const context = {
        event: "UserPromptSubmit" as const,
        projectDir: "/test/workdir",
        timestamp: new Date(),
      };

      await manager.executeHooks("UserPromptSubmit", context);

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "/my/plugin/root/scripts/hook.sh",
        expect.objectContaining({
          env: expect.objectContaining({
            WAVE_PLUGIN_ROOT: "/my/plugin/root",
          }),
        }),
        undefined,
      );
    });

    it("should not substitute ${WAVE_PLUGIN_ROOT} for non-plugin hooks", async () => {
      manager.loadConfiguration({
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command" as const,
                command: "${WAVE_PLUGIN_ROOT}/scripts/hook.sh",
              },
            ],
          },
        ],
      });

      const context = {
        event: "UserPromptSubmit" as const,
        projectDir: "/test/workdir",
        timestamp: new Date(),
      };

      await manager.executeHooks("UserPromptSubmit", context);

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "${WAVE_PLUGIN_ROOT}/scripts/hook.sh",
        expect.any(Object),
        undefined,
      );
    });
  });
});
