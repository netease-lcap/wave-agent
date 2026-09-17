import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { uninstallPluginCommand } from "../../../src/commands/plugin/uninstall.js";

// Mock process.exit
const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
  return undefined as never;
});

// Mock console.log/error
const mockLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockError = vi.spyOn(console, "error").mockImplementation(function () {});

// Mock PluginCore
const { mockPluginCore } = vi.hoisted(() => ({
  mockPluginCore: {
    uninstallPlugin: vi.fn(),
  },
}));

vi.mock("wave-agent-sdk", async () => {
  const actual = (await vi.importActual(
    "wave-agent-sdk",
  )) as typeof import("wave-agent-sdk");
  return {
    ...actual,
    PluginCore: vi.fn().mockImplementation(function () {
      return mockPluginCore;
    }),
  };
});

describe("Plugin Uninstall Scope", () => {
  beforeEach(() => {
    mockLog.mockClear();
    mockError.mockClear();
    mockExit.mockClear();
    mockPluginCore.uninstallPlugin.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should uninstall only the given scope", async () => {
    // spec plugin A-015：--scope 指定哪个作用域就只卸载哪个
    mockPluginCore.uninstallPlugin.mockResolvedValue("project");

    await uninstallPluginCommand({
      plugin: "test-plugin@market",
      scope: "project",
    });

    expect(mockPluginCore.uninstallPlugin).toHaveBeenCalledWith(
      "test-plugin@market",
      "project",
    );
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "Successfully uninstalled plugin: test-plugin@market (scope: project)",
      ),
    );
  });

  it("should let the core detect the scope when --scope is omitted", async () => {
    mockPluginCore.uninstallPlugin.mockResolvedValue("user");

    await uninstallPluginCommand({ plugin: "test-plugin@market" });

    expect(mockPluginCore.uninstallPlugin).toHaveBeenCalledWith(
      "test-plugin@market",
      undefined,
    );
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining("(scope: user)"),
    );
  });

  it("should report the failure and exit with code 1", async () => {
    mockPluginCore.uninstallPlugin.mockRejectedValue(
      new Error("Plugin test-plugin@market is not enabled in any scope"),
    );

    await uninstallPluginCommand({ plugin: "test-plugin@market" });

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining(
        "Failed to uninstall plugin: Plugin test-plugin@market is not enabled in any scope",
      ),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
