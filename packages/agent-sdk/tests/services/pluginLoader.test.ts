import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { PluginLoader } from "../../src/services/pluginLoader.js";
import { scanCommandsDirectory } from "../../src/utils/customCommands.js";
import { CustomSlashCommand } from "../../src/types/index.js";

vi.mock("fs/promises");
vi.mock("path");
vi.mock("../../src/utils/customCommands.js");

describe("PluginLoader", () => {
  const mockPluginPath = "/mock/plugin/path";
  const mockManifestPath = "/mock/plugin/path/.wave-plugin/plugin.json";

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock path.join to return a predictable string
    vi.mocked(path.join).mockImplementation((...args: string[]) =>
      args.join("/"),
    );
  });

  describe("loadManifest", () => {
    it("should successfully load and validate a manifest", async () => {
      const mockManifest = {
        name: "test-plugin",
        description: "A test plugin",
        version: "1.0.0",
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockManifest));

      const result = await PluginLoader.loadManifest(mockPluginPath);

      expect(result).toEqual(mockManifest);
      expect(fs.readFile).toHaveBeenCalledWith(mockManifestPath, "utf-8");
    });

    it("should throw error if manifest file is not found", async () => {
      const error = new Error("File not found");
      (error as Error & { code?: string }).code = "ENOENT";
      vi.mocked(fs.readFile).mockRejectedValue(error);

      await expect(PluginLoader.loadManifest(mockPluginPath)).rejects.toThrow(
        `Plugin manifest not found at ${mockManifestPath}`,
      );
    });

    it("should throw error if manifest loading fails for other reasons", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("Permission denied"));

      await expect(PluginLoader.loadManifest(mockPluginPath)).rejects.toThrow(
        `Failed to load plugin manifest at ${mockManifestPath}: Permission denied`,
      );
    });

    it("should throw error if manifest is missing name", async () => {
      const mockManifest = {
        description: "A test plugin",
        version: "1.0.0",
      };

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify(mockManifest as unknown),
      );

      await expect(PluginLoader.loadManifest(mockPluginPath)).rejects.toThrow(
        "Plugin manifest missing 'name'",
      );
    });

    it("should throw error if manifest is missing description", async () => {
      const mockManifest = {
        name: "test-plugin",
        version: "1.0.0",
      };

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify(mockManifest as unknown),
      );

      await expect(PluginLoader.loadManifest(mockPluginPath)).rejects.toThrow(
        "Plugin manifest missing 'description'",
      );
    });

    it("should throw error if manifest is missing version", async () => {
      const mockManifest = {
        name: "test-plugin",
        description: "A test plugin",
      };

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify(mockManifest as unknown),
      );

      await expect(PluginLoader.loadManifest(mockPluginPath)).rejects.toThrow(
        "Plugin manifest missing 'version'",
      );
    });

    it("should throw error if manifest name is invalid", async () => {
      const mockManifest = {
        name: "Test Plugin", // Invalid: contains spaces and uppercase
        description: "A test plugin",
        version: "1.0.0",
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockManifest));

      await expect(PluginLoader.loadManifest(mockPluginPath)).rejects.toThrow(
        "Invalid plugin name: Test Plugin. Only lowercase letters, numbers, and hyphens are allowed.",
      );
    });
  });

  describe("loadCommands", () => {
    it("should load commands from the commands directory", () => {
      const mockCommands = [
        { id: "test-cmd", name: "test-cmd", filePath: "/path/to/cmd.md" },
      ];
      vi.mocked(scanCommandsDirectory).mockReturnValue(
        mockCommands as unknown as CustomSlashCommand[],
      );

      const result = PluginLoader.loadCommands(mockPluginPath);

      expect(result).toEqual(mockCommands);
      expect(scanCommandsDirectory).toHaveBeenCalledWith(
        `${mockPluginPath}/commands`,
      );
    });
  });
});
