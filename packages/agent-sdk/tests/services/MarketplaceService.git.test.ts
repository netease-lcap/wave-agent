import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import { existsSync } from "fs";
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
const mockExistsSync = vi.mocked(existsSync);

describe("MarketplaceService - General Git Support", () => {
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

  describe("addMarketplace with Git URLs", () => {
    it("should add a marketplace from a GitLab URL", async () => {
      const url = "https://gitlab.com/company/plugins.git";
      const manifest = {
        name: "gitlab-market",
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
        // Mock that the target path doesn't exist yet
        if (p.toString().includes("marketplaces/")) {
          return false;
        }
        return true;
      });

      const result = await service.addMarketplace(url);

      expect(result.name).toBe("gitlab-market");
      expect(result.source).toEqual({ source: "git", url, ref: undefined });
      expect(mockGitService.clone).toHaveBeenCalledWith(
        url,
        expect.any(String),
        undefined,
      );
    });

    it("should add a marketplace from a Git URL with a fragment", async () => {
      const urlWithRef = "https://gitlab.com/company/plugins.git#v1.0.0";
      const url = "https://gitlab.com/company/plugins.git";
      const ref = "v1.0.0";
      const manifest = {
        name: "gitlab-market-v1",
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
        if (p.toString().includes("marketplaces/")) {
          return false;
        }
        return true;
      });

      const result = await service.addMarketplace(urlWithRef);

      expect(result.name).toBe("gitlab-market-v1");
      expect(result.source).toEqual({ source: "git", url, ref });
      expect(mockGitService.clone).toHaveBeenCalledWith(
        url,
        expect.any(String),
        ref,
      );
    });

    it("should add a GitHub marketplace with a fragment", async () => {
      const repoWithRef = "owner/repo#branch-name";
      const repo = "owner/repo";
      const ref = "branch-name";
      const manifest = {
        name: "github-market-branch",
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
        if (p.toString().includes("marketplaces/")) {
          return false;
        }
        return true;
      });

      const result = await service.addMarketplace(repoWithRef);

      expect(result.name).toBe("github-market-branch");
      expect(result.source).toEqual({ source: "github", repo, ref });
      expect(mockGitService.clone).toHaveBeenCalledWith(
        repo,
        expect.any(String),
        ref,
      );
    });
  });

  describe("installPlugin with Git sources", () => {
    it("should install a plugin from a Git URL source", async () => {
      const marketplaceName = "test-market";
      const pluginName = "git-plugin";
      const gitSource = "https://github.com/other/plugin.git#v2.0.0";
      const [url, ref] = gitSource.split("#");

      mockReadFile.mockImplementation(async (p) => {
        const pathStr = p.toString();
        if (pathStr.includes("known_marketplaces.json")) {
          return JSON.stringify({
            marketplaces: [
              {
                name: marketplaceName,
                source: { source: "directory", path: "/mock/market" },
              },
            ],
          });
        }
        if (pathStr.includes("marketplace.json")) {
          return JSON.stringify({
            name: marketplaceName,
            plugins: [{ name: pluginName, source: gitSource }],
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
      expect(mockGitService.clone).toHaveBeenCalledWith(
        url,
        expect.stringContaining("clone-"),
        ref,
      );
      expect(vi.mocked(fsPromises.rename)).toHaveBeenCalled();
    });
  });

  describe("updateMarketplace with Git sources", () => {
    it("should update Git marketplaces", async () => {
      const marketplaces = [
        {
          name: "m1",
          source: {
            source: "git",
            url: "https://gitlab.com/repo.git",
            ref: "main",
          },
        },
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

      expect(mockGitService.pull).toHaveBeenCalled();
    });
  });
});
