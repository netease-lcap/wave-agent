import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import * as os from "os";
import { existsSync } from "fs";
import { MarketplaceService } from "../../src/services/MarketplaceService.js";
import { GitService } from "../../src/services/GitService.js";

vi.mock("../../src/services/GitService.js");

vi.mock("../../src/services/configurationService.js", () => {
  return {
    ConfigurationService: class MockConfigService {
      getMergedMarketplaces() {
        return {};
      }
      getScopedMarketplaces() {
        return {};
      }
      addMarketplaceToScope() {
        return Promise.resolve();
      }
      removeMarketplaceFromScope() {
        return Promise.resolve();
      }
      getMergedEnabledPlugins() {
        return {};
      }
    },
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
      open: vi.fn(),
      unlink: vi.fn(),
    },
  };
});

import { promises as fsPromises } from "fs";

const mockReadFile = vi.mocked(fsPromises.readFile);
const mockOpen = vi.mocked(fsPromises.open);
const mockUnlink = vi.mocked(fsPromises.unlink);
const mockExistsSync = vi.mocked(existsSync);

describe("MarketplaceService - General Git Support", () => {
  let userHome: string;
  let service: MarketplaceService;
  let mockGitService: {
    clone: ReturnType<typeof vi.fn>;
    pull: ReturnType<typeof vi.fn>;
    checkout: ReturnType<typeof vi.fn>;
    isGitAvailable: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    userHome = "/mock/home";
    vi.mocked(os.homedir).mockReturnValue(userHome);
    vi.mocked(fsPromises.mkdtemp).mockResolvedValue(userHome);
    mockOpen.mockResolvedValue({ close: vi.fn() } as unknown as Awaited<
      ReturnType<typeof fsPromises.open>
    >);
    mockUnlink.mockResolvedValue(undefined);

    mockGitService = {
      clone: vi.fn(),
      pull: vi.fn(),
      checkout: vi.fn(),
      isGitAvailable: vi.fn().mockResolvedValue(true),
    };
    vi.mocked(GitService).mockImplementation(function () {
      return mockGitService as unknown as GitService;
    });

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
        const s = p.toString().replace(/\\/g, "/");
        if (s.includes(".wave-plugin/marketplace.json")) {
          return true;
        }
        // Mock that the target path doesn't exist yet
        if (s.includes("marketplaces/")) {
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
        const s = p.toString().replace(/\\/g, "/");
        if (s.includes(".wave-plugin/marketplace.json")) {
          return true;
        }
        if (s.includes("marketplaces/")) {
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
        const s = p.toString().replace(/\\/g, "/");
        if (s.includes(".wave-plugin/marketplace.json")) {
          return true;
        }
        if (s.includes("marketplaces/")) {
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
    /** 市场清单里放一条插件条目（可带任意 source 形态），其余读取走最小替身。 */
    function mockMarketplaceWithSource(source: unknown): void {
      mockReadFile.mockImplementation(async (p) => {
        const pathStr = p.toString();
        if (pathStr.includes("known_marketplaces.json")) {
          return JSON.stringify({
            marketplaces: [
              {
                name: "test-market",
                source: { source: "directory", path: "/mock/market" },
              },
            ],
          });
        }
        if (pathStr.includes("marketplace.json")) {
          return JSON.stringify({
            name: "test-market",
            plugins: [{ name: "git-plugin", source }],
          });
        }
        if (pathStr.includes("plugin.json")) {
          // 故意不写 version：CC 生态的 plugin.json 常常没有版本字段
          return JSON.stringify({
            name: "git-plugin",
            description: "A test plugin",
          });
        }
        if (pathStr.includes("installed_plugins.json")) {
          return JSON.stringify({ plugins: [] });
        }
        return "";
      });
    }

    it("should install a plugin from a Git URL source", async () => {
      const marketplaceName = "test-market";
      const pluginName = "git-plugin";
      const gitSource = "https://github.com/other/plugin.git#v2.0.0";
      const [url, ref] = gitSource.split("#");

      mockMarketplaceWithSource(gitSource);

      mockExistsSync.mockReturnValue(true);

      const result = await service.installPlugin(
        `${pluginName}@${marketplaceName}`,
        { scope: "project", projectPath: "/mock/project" },
      );

      expect(result.name).toBe(pluginName);
      expect(result.scope).toBe("project");
      expect(result.projectPath).toBe("/mock/project");
      expect(mockGitService.clone).toHaveBeenCalledWith(
        url,
        expect.stringContaining("clone-"),
        ref,
      );
      expect(vi.mocked(fsPromises.rename)).toHaveBeenCalled();
    });

    it("should install a plugin from an object url source", async () => {
      // {"source":"url"} 与字符串 Git URL 等价（A-021）
      mockMarketplaceWithSource({
        source: "url",
        url: "https://github.com/other/plugin.git",
      });
      mockExistsSync.mockReturnValue(true);

      const result = await service.installPlugin("git-plugin@test-market", {
        scope: "project",
        projectPath: "/mock/project",
      });

      expect(mockGitService.clone).toHaveBeenCalledWith(
        "https://github.com/other/plugin.git",
        expect.stringContaining("clone-"),
        undefined,
      );
      expect(mockGitService.checkout).not.toHaveBeenCalled();
      expect(result.version).toBe("1.0.0");
    });

    it("should install from the subdirectory named by a git-subdir source", async () => {
      mockMarketplaceWithSource({
        source: "git-subdir",
        url: "https://github.com/other/monorepo.git",
        path: "plugins/foo",
      });
      mockExistsSync.mockReturnValue(true);

      await service.installPlugin("git-plugin@test-market", {
        scope: "project",
        projectPath: "/mock/project",
      });

      const subdirRename = vi
        .mocked(fsPromises.rename)
        .mock.calls.find(([from]) => /plugins[\\/]foo$/.test(String(from)));
      expect(subdirRename).toBeDefined();
    });

    it("should fail when the git-subdir path does not exist in the repository", async () => {
      mockMarketplaceWithSource({
        source: "git-subdir",
        url: "https://github.com/other/monorepo.git",
        path: "plugins/missing",
      });
      // 克隆目录存在，但清单里写的子目录不存在 → 明确报错，不许悄悄装整个仓库
      // 分隔符无关：Windows 上 path.join 拼出的是 …\plugins\missing
      mockExistsSync.mockImplementation(
        (p) => !/plugins[\\/]missing$/.test(p.toString()),
      );

      await expect(
        service.installPlugin("git-plugin@test-market", {
          scope: "project",
          projectPath: "/mock/project",
        }),
      ).rejects.toThrow(
        "Subdirectory 'plugins/missing' not found in repository https://github.com/other/monorepo.git",
      );
    });

    it("should check out the pinned sha after cloning", async () => {
      mockMarketplaceWithSource({
        source: "git-subdir",
        url: "https://github.com/other/monorepo.git",
        path: "plugins/foo",
        ref: "main",
        sha: "abc1234",
      });
      mockExistsSync.mockReturnValue(true);

      await service.installPlugin("git-plugin@test-market", {
        scope: "project",
        projectPath: "/mock/project",
      });

      expect(mockGitService.clone).toHaveBeenCalledWith(
        "https://github.com/other/monorepo.git",
        expect.stringContaining("clone-"),
        "main",
      );
      expect(mockGitService.checkout).toHaveBeenCalledWith(
        expect.stringContaining("clone-"),
        "abc1234",
      );
    });

    it("should fail loudly when the pinned sha cannot be checked out", async () => {
      // 不许静默退回分支最新提交（A-021 场景 3）
      mockMarketplaceWithSource({
        source: "url",
        url: "https://github.com/other/plugin.git",
        sha: "deadbeef",
      });
      mockExistsSync.mockReturnValue(true);
      mockGitService.checkout.mockRejectedValue(new Error("unknown revision"));

      await expect(
        service.installPlugin("git-plugin@test-market", {
          scope: "project",
          projectPath: "/mock/project",
        }),
      ).rejects.toThrow("unknown revision");
    });

    it("should fail with the offending shape for an unsupported source object", async () => {
      mockMarketplaceWithSource({
        source: "npm",
        url: "https://example.com/a",
      });
      mockExistsSync.mockReturnValue(true);

      await expect(
        service.installPlugin("git-plugin@test-market", {
          scope: "project",
          projectPath: "/mock/project",
        }),
      ).rejects.toThrow('declares an unsupported source: {"source":"npm"');
      expect(mockGitService.clone).not.toHaveBeenCalled();
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
