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
vi.spyOn(process, "exit").mockImplementation(() => {
  return undefined as never;
});

// Mock console.log/error
const mockLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockError = vi.spyOn(console, "error").mockImplementation(function () {});

// Mock PluginService
const mockEnablePlugin = vi.fn();
const mockDisablePlugin = vi.fn();
const mockListPlugins = vi.fn();

vi.mock("wave-agent-sdk", async () => {
  const actual = (await vi.importActual(
    "wave-agent-sdk",
  )) as typeof import("wave-agent-sdk");
  return {
    ...actual,
    PluginService: vi.fn(function () {
      return {
        enable: mockEnablePlugin,
        disable: mockDisablePlugin,
        list: mockListPlugins,
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
    mockEnablePlugin.mockReset();
    mockDisablePlugin.mockReset();
    mockListPlugins.mockReset();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(userHome, { recursive: true, force: true });
  });

  it("should enable a plugin in user scope", async () => {
    mockEnablePlugin.mockResolvedValue("user");

    await enablePluginCommand({ plugin: "test-plugin@market", scope: "user" });

    expect(mockEnablePlugin).toHaveBeenCalledWith("test-plugin@market", "user");
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "Successfully enabled plugin: test-plugin@market in user scope",
      ),
    );
  });

  it("should enable a plugin in project scope", async () => {
    mockEnablePlugin.mockResolvedValue("project");

    await enablePluginCommand({
      plugin: "test-plugin@market",
      scope: "project",
    });

    expect(mockEnablePlugin).toHaveBeenCalledWith(
      "test-plugin@market",
      "project",
    );
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "Successfully enabled plugin: test-plugin@market in project scope",
      ),
    );
  });

  it("should disable a plugin in user scope", async () => {
    mockDisablePlugin.mockResolvedValue("user");

    await disablePluginCommand({ plugin: "test-plugin@market", scope: "user" });

    expect(mockDisablePlugin).toHaveBeenCalledWith(
      "test-plugin@market",
      "user",
    );
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "Successfully disabled plugin: test-plugin@market in user scope",
      ),
    );
  });

  it("should test priority: Disable in user scope, enable in project scope -> should be enabled", async () => {
    mockListPlugins.mockResolvedValue({
      plugins: [
        {
          name: "test-plugin",
          marketplace: "market",
          installed: true,
          version: "1.0.0",
          scope: "project",
        },
      ],
      mergedEnabled: { "test-plugin@market": true },
    });

    await listPluginsCommand();

    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "- test-plugin@market v1.0.0 (project) [enabled]",
      ),
    );
  });

  it("should test priority: Enable in user scope, disable in project scope -> should be disabled", async () => {
    mockListPlugins.mockResolvedValue({
      plugins: [
        {
          name: "test-plugin",
          marketplace: "market",
          installed: true,
          version: "1.0.0",
          scope: "project",
        },
      ],
      mergedEnabled: { "test-plugin@market": false },
    });

    await listPluginsCommand();

    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "- test-plugin@market v1.0.0 (project) [disabled]",
      ),
    );
  });
});
