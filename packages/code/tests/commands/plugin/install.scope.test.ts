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
const mockError = vi.spyOn(console, "error").mockImplementation(() => {});

// Mock MarketplaceService
vi.mock("wave-agent-sdk", async () => {
  const actual = (await vi.importActual(
    "wave-agent-sdk",
  )) as typeof import("wave-agent-sdk");
  return {
    ...actual,
    MarketplaceService: vi.fn().mockImplementation(() => ({
      installPlugin: vi.fn().mockResolvedValue({
        name: "test-plugin",
        marketplace: "market",
        version: "1.0.0",
        cachePath: "/fake/cache/path",
      }),
    })),
  };
});

describe("Plugin Install Scope Integration Tests", () => {
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

  it("should install and enable a plugin in user scope", async () => {
    await installPluginCommand({ plugin: "test-plugin@market", scope: "user" });

    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "Successfully installed plugin: test-plugin v1.0.0 from market",
      ),
    );
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "Plugin test-plugin@market enabled in user scope",
      ),
    );

    const userConfigPath = path.join(userHome, ".wave", "settings.json");
    const config = JSON.parse(await fs.readFile(userConfigPath, "utf-8"));
    expect(config.enabledPlugins["test-plugin@market"]).toBe(true);
  });

  it("should install and enable a plugin in project scope", async () => {
    await installPluginCommand({
      plugin: "test-plugin@market",
      scope: "project",
    });

    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "Successfully installed plugin: test-plugin v1.0.0 from market",
      ),
    );
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "Plugin test-plugin@market enabled in project scope",
      ),
    );

    const projectConfigPath = path.join(tempDir, ".wave", "settings.json");
    const config = JSON.parse(await fs.readFile(projectConfigPath, "utf-8"));
    expect(config.enabledPlugins["test-plugin@market"]).toBe(true);
  });

  it("should install without enabling if no scope is provided", async () => {
    await installPluginCommand({ plugin: "test-plugin@market" });

    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "Successfully installed plugin: test-plugin v1.0.0 from market",
      ),
    );
    expect(mockLog).not.toHaveBeenCalledWith(
      expect.stringContaining("enabled in"),
    );

    const userConfigPath = path.join(userHome, ".wave", "settings.json");
    const projectConfigPath = path.join(tempDir, ".wave", "settings.json");

    expect(
      await fs
        .access(userConfigPath)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
    expect(
      await fs
        .access(projectConfigPath)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });
});
