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

// Mock MarketplaceService
const mockGetInstalledPlugins = vi.fn();
const mockListMarketplaces = vi.fn();
const mockLoadMarketplaceManifest = vi.fn();

vi.mock("wave-agent-sdk", async () => {
  const actual = (await vi.importActual(
    "wave-agent-sdk",
  )) as typeof import("wave-agent-sdk");
  return {
    ...actual,
    MarketplaceService: vi.fn(function () {
      return {
        getInstalledPlugins: mockGetInstalledPlugins,
        listMarketplaces: mockListMarketplaces,
        getMarketplacePath: vi.fn().mockReturnValue("/mock/market"),
        loadMarketplaceManifest: mockLoadMarketplaceManifest,
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

    mockGetInstalledPlugins.mockReset();
    mockListMarketplaces.mockReset();
    mockLoadMarketplaceManifest.mockReset();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(userHome, { recursive: true, force: true });
  });

  it("should handle empty plugin list", async () => {
    mockGetInstalledPlugins.mockResolvedValue({ plugins: [] });
    mockListMarketplaces.mockResolvedValue([]);

    await listPluginsCommand();

    expect(mockLog).toHaveBeenCalledWith(
      "No plugins found in registered marketplaces.",
    );
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should handle marketplace load failure", async () => {
    mockGetInstalledPlugins.mockResolvedValue({ plugins: [] });
    mockListMarketplaces.mockResolvedValue([
      {
        name: "broken-market",
        source: { source: "directory", path: "/broken" },
      },
      { name: "good-market", source: { source: "directory", path: "/good" } },
    ]);

    mockLoadMarketplaceManifest
      .mockRejectedValueOnce(new Error("Failed to load"))
      .mockResolvedValueOnce({
        name: "good-market",
        plugins: [
          { name: "good-plugin", source: "./good", description: "good" },
        ],
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
    mockGetInstalledPlugins.mockRejectedValue(new Error("Unexpected error"));

    await listPluginsCommand();

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to list plugins: Unexpected error"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should handle non-Error objects in catch block", async () => {
    mockGetInstalledPlugins.mockRejectedValue("String error");

    await listPluginsCommand();

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to list plugins: String error"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
