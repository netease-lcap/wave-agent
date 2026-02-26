import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";
import { enablePluginCommand } from "../../../src/commands/plugin/enable.js";
import { disablePluginCommand } from "../../../src/commands/plugin/disable.js";

// Mock os.homedir
vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue("/tmp/fake-home"),
  };
});

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
    enablePlugin: vi.fn(),
    disablePlugin: vi.fn(),
    findPluginScope: vi.fn(),
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

describe("Plugin Enable/Disable Command Error Tests", () => {
  let tempDir: string;
  let userHome: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-project-ed-"));
    userHome = await fs.mkdtemp(path.join(os.tmpdir(), "wave-user-home-ed-"));

    vi.mocked(os.homedir).mockReturnValue(userHome);
    process.chdir(tempDir);

    mockLog.mockClear();
    mockError.mockClear();
    mockExit.mockClear();
    mockPluginCore.enablePlugin.mockReset();
    mockPluginCore.disablePlugin.mockReset();
    mockPluginCore.findPluginScope.mockReset();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(userHome, { recursive: true, force: true });
  });

  it("should handle enable failure", async () => {
    mockPluginCore.enablePlugin.mockRejectedValue(
      new Error("Permission denied"),
    );

    await enablePluginCommand({ plugin: "test-plugin@market", scope: "user" });

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to enable plugin: Permission denied"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should handle disable failure", async () => {
    mockPluginCore.disablePlugin.mockRejectedValue(new Error("File not found"));

    await disablePluginCommand({ plugin: "test-plugin@market", scope: "user" });

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to disable plugin: File not found"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should default to user scope if not provided and not found", async () => {
    mockPluginCore.findPluginScope.mockReturnValue(null);
    mockPluginCore.enablePlugin.mockResolvedValue("user");

    await enablePluginCommand({ plugin: "test-plugin@market" });

    expect(mockPluginCore.enablePlugin).toHaveBeenCalledWith(
      "test-plugin@market",
      undefined,
    );
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining("in user scope"),
    );
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should use found scope if not provided for disable", async () => {
    mockPluginCore.findPluginScope.mockReturnValue("project");
    mockPluginCore.disablePlugin.mockResolvedValue("project");

    await disablePluginCommand({ plugin: "test-plugin@market" });

    expect(mockPluginCore.disablePlugin).toHaveBeenCalledWith(
      "test-plugin@market",
      undefined,
    );
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining("in project scope"),
    );
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should use default user scope if findPluginScope returns null for disable", async () => {
    mockPluginCore.findPluginScope.mockReturnValue(null);
    mockPluginCore.disablePlugin.mockResolvedValue("user");

    await disablePluginCommand({ plugin: "test-plugin@market" });

    expect(mockPluginCore.disablePlugin).toHaveBeenCalledWith(
      "test-plugin@market",
      undefined,
    );
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining("in user scope"),
    );
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should use found scope if not provided for enable", async () => {
    mockPluginCore.findPluginScope.mockReturnValue("project");
    mockPluginCore.enablePlugin.mockResolvedValue("project");

    await enablePluginCommand({ plugin: "test-plugin@market" });

    expect(mockPluginCore.enablePlugin).toHaveBeenCalledWith(
      "test-plugin@market",
      undefined,
    );
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining("in project scope"),
    );
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should handle non-Error objects in catch block for enable", async () => {
    mockPluginCore.enablePlugin.mockRejectedValue("String error");

    await enablePluginCommand({ plugin: "test-plugin@market", scope: "user" });

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to enable plugin: String error"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should handle non-Error objects in catch block for disable", async () => {
    mockPluginCore.disablePlugin.mockRejectedValue("String error");

    await disablePluginCommand({ plugin: "test-plugin@market", scope: "user" });

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to disable plugin: String error"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
