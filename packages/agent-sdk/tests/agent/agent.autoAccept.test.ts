import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";

// Mock os.homedir before importing Agent
vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return {
    ...(actual as typeof os),
    homedir: vi.fn(() => "/tmp"),
  };
});

import { Agent } from "@/agent.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import type { PermissionCallback } from "../../src/types/permissions.js";
import * as fs from "fs/promises";
import * as path from "path";

describe("Agent Auto-Accept Permissions Integration", () => {
  let tempDir: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-agent-test-"));
    process.env = {
      ...originalEnv,
      AIGW_TOKEN: "test-token",
      AIGW_URL: "https://test.api",
    };
    vi.mocked(os.homedir).mockReturnValue(os.tmpdir());
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should update permission mode and persist rules from callback", async () => {
    const mockCallback = vi.fn();

    const agent = await Agent.create({
      workdir: tempDir,
      permissionMode: "default",
      canUseTool: mockCallback as unknown as PermissionCallback,
    });

    // 1. Test transition to acceptEdits
    mockCallback.mockResolvedValueOnce({
      behavior: "allow",
      newPermissionMode: "acceptEdits",
    });

    // We need to trigger a permission check.
    // We'll use the toolManager directly.
    const toolManager = (agent as unknown as { toolManager: ToolManager })
      .toolManager;

    await toolManager.execute(
      "Bash",
      { command: "rm test.txt" },
      { workdir: tempDir },
    );

    expect(agent.getPermissionMode()).toBe("acceptEdits");

    // 2. Test persistent rule
    mockCallback.mockResolvedValueOnce({
      behavior: "allow",
      newPermissionRule: "Bash(whoami)",
    });

    // Switch back to default mode to test rule matching
    agent.setPermissionMode("default");

    await toolManager.execute(
      "Bash",
      { command: "whoami" },
      { workdir: tempDir },
    );

    // Check if rule was persisted to settings.local.json
    const configPath = path.join(tempDir, ".wave", "settings.local.json");
    const configContent = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(configContent);

    expect(config.permissions.allow).toContain("Bash(whoami)");

    // 3. Test that the rule actually allows the command without calling the callback
    mockCallback.mockClear();
    await toolManager.execute(
      "Bash",
      { command: "whoami" },
      { workdir: tempDir },
    );
    expect(mockCallback).not.toHaveBeenCalled();
  });

  it("should load persistent rules on startup", async () => {
    // 1. Create a settings.local.json file
    const waveDir = path.join(tempDir, ".wave");
    await fs.mkdir(waveDir, { recursive: true });
    const config = {
      permissions: {
        allow: ["Bash(rm -rf /tmp/test)"],
      },
    };
    await fs.writeFile(
      path.join(waveDir, "settings.local.json"),
      JSON.stringify(config),
    );

    // 2. Create agent
    const mockCallback = vi.fn();
    const agent = await Agent.create({
      workdir: tempDir,
      permissionMode: "default",
      canUseTool: mockCallback as unknown as PermissionCallback,
    });

    // 3. Verify rule is loaded and applied
    const toolManager = (agent as unknown as { toolManager: ToolManager })
      .toolManager;
    await toolManager.execute(
      "Bash",
      { command: "rm -rf /tmp/test" },
      { workdir: tempDir },
    );
    expect(mockCallback).not.toHaveBeenCalled();
  });

  it("should trigger onPermissionModeChange callback when mode changes", async () => {
    const mockModeCallback = vi.fn();
    const agent = await Agent.create({
      workdir: tempDir,
      callbacks: {
        onPermissionModeChange: mockModeCallback,
      },
    });

    agent.setPermissionMode("acceptEdits");
    expect(mockModeCallback).toHaveBeenCalledWith("acceptEdits");
  });

  it("should merge global and local rules", async () => {
    // 1. Setup global config
    const userHome = await fs.mkdtemp(
      path.join(os.tmpdir(), "wave-user-home-"),
    );
    vi.mocked(os.homedir).mockReturnValue(userHome);

    const userWaveDir = path.join(userHome, ".wave");
    await fs.mkdir(userWaveDir, { recursive: true });
    await fs.writeFile(
      path.join(userWaveDir, "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(global)"] } }),
    );

    // 2. Setup local config
    const projectWaveDir = path.join(tempDir, ".wave");
    await fs.mkdir(projectWaveDir, { recursive: true });
    await fs.writeFile(
      path.join(projectWaveDir, "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(local)"] } }),
    );

    // 3. Create agent
    const mockCallback = vi.fn();
    const agent = await Agent.create({
      workdir: tempDir,
      permissionMode: "default",
      canUseTool: mockCallback as unknown as PermissionCallback,
    });

    // 4. Verify both rules are applied
    const toolManager = (agent as unknown as { toolManager: ToolManager })
      .toolManager;

    await toolManager.execute(
      "Bash",
      { command: "global" },
      { workdir: tempDir },
    );
    expect(mockCallback).not.toHaveBeenCalled();

    await toolManager.execute(
      "Bash",
      { command: "local" },
      { workdir: tempDir },
    );
    expect(mockCallback).not.toHaveBeenCalled();

    await fs.rm(userHome, { recursive: true, force: true });
  });

  it("should split chained bash commands and filter safe ones when persisting rules", async () => {
    const mockCallback = vi.fn();
    const agent = await Agent.create({
      workdir: tempDir,
      permissionMode: "default",
      canUseTool: mockCallback as unknown as PermissionCallback,
    });

    const toolManager = (agent as unknown as { toolManager: ToolManager })
      .toolManager;

    // 1. Trigger permission check for a chained command
    mockCallback.mockResolvedValueOnce({
      behavior: "allow",
      newPermissionRule: "Bash(mkdir -p test && cd test)",
    });

    // Create the directory so cd test is considered safe
    await fs.mkdir(path.join(tempDir, "test"));

    await toolManager.execute(
      "Bash",
      { command: "mkdir -p test && cd test" },
      { workdir: tempDir },
    );

    // 2. Check if rules were split and filtered in settings.local.json
    const configPath = path.join(tempDir, ".wave", "settings.local.json");
    const configContent = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(configContent);

    // Should contain mkdir -p test but NOT cd test
    expect(config.permissions.allow).toContain("Bash(mkdir -p test)");
    expect(config.permissions.allow).not.toContain("Bash(cd test)");
    expect(config.permissions.allow).not.toContain(
      "Bash(mkdir -p test && cd test)",
    );

    // 3. Verify that mkdir -p test is now auto-allowed
    mockCallback.mockClear();
    await toolManager.execute(
      "Bash",
      { command: "mkdir -p test" },
      { workdir: tempDir },
    );
    expect(mockCallback).not.toHaveBeenCalled();
  });
});
