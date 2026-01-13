import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import { existsSync, mkdirSync } from "fs";
import * as path from "path";
import { MarketplaceService } from "../../src/services/MarketplaceService.js";

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

  beforeEach(async () => {
    userHome = "/mock/home";
    vi.mocked(os.homedir).mockReturnValue(userHome);
    vi.mocked(fsPromises.mkdtemp).mockResolvedValue(userHome);

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
  });

  describe("addMarketplace", () => {
    it("should add a new marketplace", async () => {
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
      expect(result.path).toBe(path.resolve(marketplacePath));
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should throw error if manifest is missing", async () => {
      mockExistsSync.mockReturnValue(false);
      await expect(service.addMarketplace("/invalid/path")).rejects.toThrow(
        "Marketplace manifest not found",
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

  describe("installPlugin", () => {
    it("should install a plugin from a marketplace", async () => {
      const marketplacePath = "/mock/market";
      const pluginName = "test-plugin";
      const marketplaceName = "test-market";

      // Mock listMarketplaces
      mockReadFile.mockImplementation(async (p) => {
        const pathStr = p.toString();
        if (pathStr.includes("known_marketplaces.json")) {
          return JSON.stringify({
            marketplaces: [{ name: marketplaceName, path: marketplacePath }],
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
  });
});
