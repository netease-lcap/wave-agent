import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";
import { listPluginsCommand } from "../../../src/commands/plugin/list.js";

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

// Mock PluginService
const mockListPlugins = vi.fn();

vi.mock("wave-agent-sdk", async () => {
  const actual = (await vi.importActual(
    "wave-agent-sdk",
  )) as typeof import("wave-agent-sdk");
  return {
    ...actual,
    PluginService: vi.fn(function () {
      return {
        list: mockListPlugins,
      };
    }),
  };
});

describe("Plugin List Command Tests", () => {
  let tempDir: string;
  let userHome: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-project-list-"));
    userHome = await fs.mkdtemp(path.join(os.tmpdir(), "wave-user-home-list-"));

    vi.mocked(os.homedir).mockReturnValue(userHome);
    process.chdir(tempDir);

    mockLog.mockClear();
    mockError.mockClear();
    mockExit.mockClear();

    mockListPlugins.mockReset();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(userHome, { recursive: true, force: true });
  });

  it("should handle empty plugin list", async () => {
    mockListPlugins.mockResolvedValue({ plugins: [], mergedEnabled: {} });

    await listPluginsCommand();

    expect(mockLog).toHaveBeenCalledWith(
      "No plugins found in registered marketplaces.",
    );
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should handle marketplace load failure", async () => {
    mockListPlugins.mockResolvedValue({
      plugins: [
        {
          name: "good-plugin",
          marketplace: "good-market",
          installed: true,
          version: "1.0.0",
          scope: "user",
        },
      ],
      mergedEnabled: { "good-plugin@good-market": true },
    });

    await listPluginsCommand();

    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining("good-plugin@good-market"),
    );
    expect(mockLog).not.toHaveBeenCalledWith(
      expect.stringContaining("broken-market"),
    );
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should handle general error in list command", async () => {
    mockListPlugins.mockRejectedValue(new Error("Unexpected error"));

    await listPluginsCommand();

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to list plugins: Unexpected error"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should handle non-Error objects in catch block", async () => {
    mockListPlugins.mockRejectedValue("String error");

    await listPluginsCommand();

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to list plugins: String error"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
