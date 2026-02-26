import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";
import { enablePluginCommand } from "../../../src/commands/plugin/enable.js";
import { disablePluginCommand } from "../../../src/commands/plugin/disable.js";
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
vi.mock("wave-agent-sdk", async () => {
  const actual = (await vi.importActual(
    "wave-agent-sdk",
  )) as typeof import("wave-agent-sdk");
  return {
    ...actual,
    MarketplaceService: vi.fn(function () {
      return {
        getInstalledPlugins: vi.fn().mockResolvedValue({
          plugins: [
            { name: "test-plugin", marketplace: "market", version: "1.0.0" },
          ],
        }),
        listMarketplaces: vi.fn().mockResolvedValue([
          {
            name: "market",
            source: { source: "directory", path: "/mock/market" },
          },
        ]),
        getMarketplacePath: vi.fn().mockReturnValue("/mock/market"),
        loadMarketplaceManifest: vi.fn().mockResolvedValue({
          name: "market",
          plugins: [
            {
              name: "test-plugin",
              source: "./test-plugin",
              description: "test",
            },
          ],
        }),
      };
    }),
  };
});

describe("Plugin Scope Integration Tests", () => {
  let tempDir: string;
  let userHome: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-project-"));
    userHome = await fs.mkdtemp(path.join(os.tmpdir(), "wave-user-home-"));

    vi.mocked(os.homedir).mockReturnValue(userHome);
    process.chdir(tempDir);

    mockLog.mockClear();
    mockError.mockClear();
    mockExit.mockClear();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(userHome, { recursive: true, force: true });
  });

  it("should enable a plugin in user scope", async () => {
    await enablePluginCommand({ plugin: "test-plugin@market", scope: "user" });

    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "Successfully enabled plugin: test-plugin@market in user scope",
      ),
    );

    const userConfigPath = path.join(userHome, ".wave", "settings.json");
    const config = JSON.parse(await fs.readFile(userConfigPath, "utf-8"));
    expect(config.enabledPlugins["test-plugin@market"]).toBe(true);
  });

  it("should enable a plugin in project scope", async () => {
    await enablePluginCommand({
      plugin: "test-plugin@market",
      scope: "project",
    });

    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "Successfully enabled plugin: test-plugin@market in project scope",
      ),
    );

    const projectConfigPath = path.join(tempDir, ".wave", "settings.json");
    const config = JSON.parse(await fs.readFile(projectConfigPath, "utf-8"));
    expect(config.enabledPlugins["test-plugin@market"]).toBe(true);
  });

  it("should disable a plugin in user scope", async () => {
    await disablePluginCommand({ plugin: "test-plugin@market", scope: "user" });

    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "Successfully disabled plugin: test-plugin@market in user scope",
      ),
    );

    const userConfigPath = path.join(userHome, ".wave", "settings.json");
    const config = JSON.parse(await fs.readFile(userConfigPath, "utf-8"));
    expect(config.enabledPlugins["test-plugin@market"]).toBe(false);
  });

  it("should test priority: Disable in user scope, enable in project scope -> should be enabled", async () => {
    // 1. Disable in user scope
    await disablePluginCommand({ plugin: "test-plugin@market", scope: "user" });

    // 2. Enable in project scope
    await enablePluginCommand({
      plugin: "test-plugin@market",
      scope: "project",
    });

    // 3. List plugins
    mockLog.mockClear();
    await listPluginsCommand();

    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "- test-plugin@market v1.0.0 (project) [enabled]",
      ),
    );
  });

  it("should test priority: Enable in user scope, disable in project scope -> should be disabled", async () => {
    // 1. Enable in user scope
    await enablePluginCommand({ plugin: "test-plugin@market", scope: "user" });

    // 2. Disable in project scope
    await disablePluginCommand({
      plugin: "test-plugin@market",
      scope: "project",
    });

    // 3. List plugins
    mockLog.mockClear();
    await listPluginsCommand();

    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "- test-plugin@market v1.0.0 (project) [disabled]",
      ),
    );
  });
});
