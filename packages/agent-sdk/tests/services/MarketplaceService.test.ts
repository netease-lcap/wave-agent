import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import { existsSync, mkdirSync } from "fs";
import * as path from "path";
import { MarketplaceService } from "../../src/services/MarketplaceService.js";
import { GitService } from "../../src/services/GitService.js";

vi.mock("../../src/services/GitService.js");

vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return {
    ...(actual as typeof os),
    homedir: vi.fn(),
  };
});

vi.mock("fs", async () => {
  return {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    promises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      rm: vi.fn(),
      mkdtemp: vi.fn(),
      cp: vi.fn(),
      rename: vi.fn(),
      mkdir: vi.fn(),
    },
  };
});

import { promises as fsPromises } from "fs";

const mockReadFile = vi.mocked(fsPromises.readFile);
const mockWriteFile = vi.mocked(fsPromises.writeFile);
const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);

describe("MarketplaceService", () => {
  let userHome: string;
  let service: MarketplaceService;
  let mockGitService: {
    clone: ReturnType<typeof vi.fn>;
    pull: ReturnType<typeof vi.fn>;
    isGitAvailable: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    userHome = "/mock/home";
    vi.mocked(os.homedir).mockReturnValue(userHome);
    vi.mocked(fsPromises.mkdtemp).mockResolvedValue(userHome);

    mockGitService = {
      clone: vi.fn(),
      pull: vi.fn(),
      isGitAvailable: vi.fn().mockResolvedValue(true),
    };
    vi.mocked(GitService).mockImplementation(
      () => mockGitService as unknown as GitService,
    );

    mockExistsSync.mockReturnValue(true);
    service = new MarketplaceService();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("should initialize directory structure", () => {
    mockExistsSync.mockReturnValue(false);
    new MarketplaceService();

    const pluginsDir = path.join(userHome, ".wave", "plugins");
    expect(mockMkdirSync).toHaveBeenCalledWith(pluginsDir, { recursive: true });
    expect(mockMkdirSync).toHaveBeenCalledWith(path.join(pluginsDir, "tmp"), {
      recursive: true,
    });
    expect(mockMkdirSync).toHaveBeenCalledWith(path.join(pluginsDir, "cache"), {
      recursive: true,
    });
    expect(mockMkdirSync).toHaveBeenCalledWith(
      path.join(pluginsDir, "marketplaces"),
      {
        recursive: true,
      },
    );
  });

  describe("addMarketplace", () => {
    it("should add a new local marketplace", async () => {
      const marketplacePath = path.join(userHome, "my-market");
      const manifest = {
        name: "test-market",
        owner: { name: "test" },
        plugins: [],
      };

      mockReadFile.mockImplementation(async (p) => {
        if (p.toString().includes("marketplace.json")) {
          return JSON.stringify(manifest);
        }
        if (p.toString().includes("known_marketplaces.json")) {
          return JSON.stringify({ marketplaces: [] });
        }
        return "";
      });

      mockExistsSync.mockReturnValue(true);

      const result = await service.addMarketplace(marketplacePath);

      expect(result.name).toBe("test-market");
      expect(result.source).toEqual({
        source: "directory",
        path: path.resolve(marketplacePath),
      });
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should add a GitHub marketplace", async () => {
      const repo = "owner/repo";
      const manifest = {
        name: "github-market",
        plugins: [],
      };

      mockReadFile.mockImplementation(async (p) => {
        if (p.toString().includes("marketplace.json")) {
          return JSON.stringify(manifest);
        }
        if (p.toString().includes("known_marketplaces.json")) {
          return JSON.stringify({ marketplaces: [] });
        }
        return "";
      });

      mockExistsSync.mockImplementation((p) => {
        if (p.toString().includes(".wave-plugin/marketplace.json")) {
          return true;
        }
        if (p.toString().includes("marketplaces/owner/repo")) {
          return false;
        }
        return true;
      });

      const result = await service.addMarketplace(repo);

      expect(result.name).toBe("github-market");
      expect(result.source).toEqual({ source: "github", repo, ref: undefined });
      expect(mockGitService.clone).toHaveBeenCalledWith(
        repo,
        expect.stringContaining(repo),
        undefined,
      );
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should throw error if manifest is missing", async () => {
      mockExistsSync.mockReturnValue(false);
      await expect(service.addMarketplace("/invalid/path")).rejects.toThrow(
        "Marketplace manifest not found",
      );
    });

    it("should handle git clone error in addMarketplace", async () => {
      const repo = "owner/repo";
      mockExistsSync.mockImplementation((p) => {
        if (p.toString().includes("marketplaces/owner/repo")) {
          return false;
        }
        return true;
      });
      mockGitService.clone.mockRejectedValue(new Error("Repository not found"));

      await expect(service.addMarketplace(repo)).rejects.toThrow(
        "Failed to add marketplace from Git: Repository not found",
      );
    });
  });

  describe("listMarketplaces", () => {
    it("should return empty list if no marketplaces registered", async () => {
      mockExistsSync.mockReturnValue(false);
      const list = await service.listMarketplaces();
      expect(list).toEqual([]);
    });
  });

  describe("updateMarketplace", () => {
    it("should update all marketplaces", async () => {
      const marketplaces = [
        { name: "m1", source: { source: "github", repo: "o1/r1" } },
        { name: "m2", source: { source: "directory", path: "/p2" } },
      ];

      mockReadFile.mockImplementation(async (p) => {
        if (p.toString().includes("known_marketplaces.json")) {
          return JSON.stringify({ marketplaces });
        }
        if (p.toString().includes("marketplace.json")) {
          return JSON.stringify({ name: "mock", plugins: [] });
        }
        return "";
      });

      mockExistsSync.mockReturnValue(true);

      await service.updateMarketplace();

      expect(mockGitService.pull).toHaveBeenCalledTimes(1);
      expect(mockGitService.pull).toHaveBeenCalledWith(
        expect.stringContaining("o1/r1"),
      );
    });

    it("should update a specific marketplace", async () => {
      const marketplaces = [
        { name: "m1", source: { source: "github", repo: "o1/r1" } },
      ];

      mockReadFile.mockImplementation(async (p) => {
        if (p.toString().includes("known_marketplaces.json")) {
          return JSON.stringify({ marketplaces });
        }
        if (p.toString().includes("marketplace.json")) {
          return JSON.stringify({ name: "m1", plugins: [] });
        }
        return "";
      });

      mockExistsSync.mockReturnValue(true);

      await service.updateMarketplace("m1");

      expect(mockGitService.pull).toHaveBeenCalledWith(
        expect.stringContaining("o1/r1"),
      );
    });

    it("should throw error if marketplace not found", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ marketplaces: [] }));
      mockExistsSync.mockReturnValue(true);

      await expect(service.updateMarketplace("non-existent")).rejects.toThrow(
        "Marketplace non-existent not found",
      );
    });

    it("should handle multiple errors in updateMarketplace", async () => {
      const marketplaces = [
        { name: "m1", source: { source: "github", repo: "o1/r1" } },
        { name: "m2", source: { source: "github", repo: "o2/r2" } },
      ];

      mockReadFile.mockImplementation(async (p) => {
        if (p.toString().includes("known_marketplaces.json")) {
          return JSON.stringify({ marketplaces });
        }
        return "";
      });

      mockExistsSync.mockReturnValue(true);
      mockGitService.pull.mockRejectedValue(new Error("Pull failed"));

      await expect(service.updateMarketplace()).rejects.toThrow(
        /Some marketplaces failed to update/,
      );
      expect(mockGitService.pull).toHaveBeenCalledTimes(2);
    });

    it("should skip GitHub marketplaces if git is not available", async () => {
      const marketplaces = [
        { name: "m1", source: { source: "github", repo: "o1/r1" } },
        { name: "m2", source: { source: "directory", path: "/p2" } },
      ];

      mockReadFile.mockImplementation(async (p) => {
        if (p.toString().includes("known_marketplaces.json")) {
          return JSON.stringify({ marketplaces });
        }
        if (p.toString().includes("marketplace.json")) {
          return JSON.stringify({ name: "mock", plugins: [] });
        }
        return "";
      });

      mockExistsSync.mockReturnValue(true);
      mockGitService.isGitAvailable.mockResolvedValue(false);

      await service.updateMarketplace();

      expect(mockGitService.pull).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Skipping update for Git/GitHub marketplace "m1"',
        ),
      );
      // Should still update the directory one (by re-validating manifest)
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining("p2"),
        "utf-8",
      );
    });
  });

  describe("installPlugin", () => {
    it("should install a plugin from a local marketplace", async () => {
      const marketplacePath = "/mock/market";
      const pluginName = "test-plugin";
      const marketplaceName = "test-market";

      // Mock listMarketplaces
      mockReadFile.mockImplementation(async (p) => {
        const pathStr = p.toString();
        if (pathStr.includes("known_marketplaces.json")) {
          return JSON.stringify({
            marketplaces: [
              {
                name: marketplaceName,
                source: { source: "directory", path: marketplacePath },
              },
            ],
          });
        }
        if (pathStr.includes("marketplace.json")) {
          return JSON.stringify({
            name: marketplaceName,
            plugins: [{ name: pluginName, source: "./plugin-src" }],
          });
        }
        if (pathStr.includes("plugin.json")) {
          return JSON.stringify({ name: pluginName, version: "1.2.3" });
        }
        if (pathStr.includes("installed_plugins.json")) {
          return JSON.stringify({ plugins: [] });
        }
        return "";
      });

      mockExistsSync.mockReturnValue(true);

      const result = await service.installPlugin(
        `${pluginName}@${marketplaceName}`,
      );

      expect(result.name).toBe(pluginName);
      expect(result.version).toBe("1.2.3");
      expect(result.marketplace).toBe(marketplaceName);
      expect(vi.mocked(fsPromises.cp)).toHaveBeenCalled();
      expect(vi.mocked(fsPromises.rename)).toHaveBeenCalled();
    });

    it("should install a plugin from a GitHub marketplace", async () => {
      const repo = "owner/repo";
      const pluginName = "gh-plugin";
      const marketplaceName = "gh-market";

      mockReadFile.mockImplementation(async (p) => {
        const pathStr = p.toString();
        if (pathStr.includes("known_marketplaces.json")) {
          return JSON.stringify({
            marketplaces: [
              {
                name: marketplaceName,
                source: { source: "github", repo },
              },
            ],
          });
        }
        if (pathStr.includes("marketplace.json")) {
          return JSON.stringify({
            name: marketplaceName,
            plugins: [{ name: pluginName, source: "./plugin-src" }],
          });
        }
        if (pathStr.includes("plugin.json")) {
          return JSON.stringify({ name: pluginName, version: "2.0.0" });
        }
        if (pathStr.includes("installed_plugins.json")) {
          return JSON.stringify({ plugins: [] });
        }
        return "";
      });

      mockExistsSync.mockReturnValue(true);

      const result = await service.installPlugin(
        `${pluginName}@${marketplaceName}`,
      );

      expect(result.name).toBe(pluginName);
      expect(result.marketplace).toBe(marketplaceName);

      // Check if it uses the correct path in marketplacesDir
      const expectedSrcPath = path.resolve(
        userHome,
        ".wave",
        "plugins",
        "marketplaces",
        repo,
        "./plugin-src",
      );
      expect(vi.mocked(fsPromises.cp)).toHaveBeenCalledWith(
        expectedSrcPath,
        expect.any(String),
        expect.any(Object),
      );
    });
  });
});
