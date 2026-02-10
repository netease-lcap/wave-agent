import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";
import { installPluginCommand } from "../../../src/commands/plugin/install.js";

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

// Mock MarketplaceService
const mockInstallPlugin = vi.fn();

vi.mock("wave-agent-sdk", async () => {
  const actual = (await vi.importActual(
    "wave-agent-sdk",
  )) as typeof import("wave-agent-sdk");
  return {
    ...actual,
    MarketplaceService: vi.fn(function () {
      return {
        installPlugin: mockInstallPlugin,
      };
    }),
  };
});

describe("Plugin Install Command Error Tests", () => {
  let tempDir: string;
  let userHome: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-project-install-"));
    userHome = await fs.mkdtemp(
      path.join(os.tmpdir(), "wave-user-home-install-"),
    );

    vi.mocked(os.homedir).mockReturnValue(userHome);
    process.chdir(tempDir);

    mockLog.mockClear();
    mockError.mockClear();
    mockExit.mockClear();
    mockInstallPlugin.mockReset();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(userHome, { recursive: true, force: true });
  });

  it("should handle install failure", async () => {
    mockInstallPlugin.mockRejectedValue(new Error("Network error"));

    await installPluginCommand({ plugin: "test-plugin@market" });

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to install plugin: Network error"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should handle non-Error objects in catch block", async () => {
    mockInstallPlugin.mockRejectedValue("Unknown error");

    await installPluginCommand({ plugin: "test-plugin@market" });

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to install plugin: Unknown error"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
