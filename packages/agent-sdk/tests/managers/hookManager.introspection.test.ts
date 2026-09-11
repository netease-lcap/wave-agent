import { describe, it, expect, beforeEach, vi } from "vitest";
import { HookManager } from "../../src/managers/hookManager.js";
import { Container } from "../../src/utils/container.js";
import { HookMatcher } from "../../src/utils/hookMatcher.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("HookManager configuration introspection", () => {
  let manager: HookManager;

  beforeEach(() => {
    manager = new HookManager(
      new Container(),
      "/test/workdir",
      new HookMatcher(),
    );
  });

  describe("hasHooks", () => {
    it("should return false if no configuration", () => {
      expect(manager.hasHooks("UserPromptSubmit")).toBe(false);
    });

    it("should return true if event has hooks", () => {
      manager.loadConfiguration({
        UserPromptSubmit: [
          { hooks: [{ type: "command" as const, command: "echo hook" }] },
        ],
      });
      expect(manager.hasHooks("UserPromptSubmit")).toBe(true);
      expect(manager.hasHooks("Stop")).toBe(false);
    });

    it("should check toolName for tool-based events", () => {
      manager.loadConfiguration({
        PreToolUse: [
          {
            matcher: "my-tool",
            hooks: [{ type: "command" as const, command: "echo hook" }],
          },
        ],
      });
      expect(manager.hasHooks("PreToolUse", "my-tool")).toBe(true);
      expect(manager.hasHooks("PreToolUse", "other-tool")).toBe(false);
    });
  });

  describe("getConfigurationStats", () => {
    it("should return empty stats if no configuration", () => {
      const stats = manager.getConfigurationStats();
      expect(stats.totalConfigs).toBe(0);
    });

    it("should return correct stats", () => {
      manager.loadConfiguration({
        UserPromptSubmit: [
          {
            hooks: [
              { type: "command" as const, command: "echo h1" },
              { type: "command" as const, command: "echo h2" },
            ],
          },
        ],
        PreToolUse: [
          {
            matcher: "t1",
            hooks: [{ type: "command" as const, command: "echo h3" }],
          },
        ],
      });

      const stats = manager.getConfigurationStats();
      expect(stats.totalEvents).toBe(2);
      expect(stats.totalConfigs).toBe(2);
      expect(stats.totalCommands).toBe(3);
      expect(stats.eventBreakdown.UserPromptSubmit).toBe(1);
      expect(stats.eventBreakdown.PreToolUse).toBe(1);
    });
  });
});
