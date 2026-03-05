import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../src/agent.js";
import * as fs from "fs/promises";
import path from "path";
import os from "os";
import { PROJECTS_DIRECTORY } from "../src/utils/constants.js";
import { pathEncoder } from "../src/utils/pathEncoder.js";

vi.mock("../src/services/aiService.js", () => ({
  callAgent: vi.fn().mockResolvedValue({
    content: "Test response",
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }),
}));

describe("Auto Memory", () => {
  const workdir = path.join(os.tmpdir(), "wave-test-project");

  beforeEach(async () => {
    await fs.mkdir(workdir, { recursive: true });
    vi.clearAllMocks();
  });

  it("should resolve auto-memory directory and load content", async () => {
    const encodedPath = await pathEncoder.encode(workdir);
    const memoryDir = path.join(PROJECTS_DIRECTORY, encodedPath, "memory");
    const memoryFilePath = path.join(memoryDir, "MEMORY.md");

    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(memoryFilePath, "Test memory content", "utf-8");

    const agent = await Agent.create({
      workdir,
      autoMemoryEnabled: true,
    });

    expect(agent.getAutoMemoryEnabled()).toBe(true);
    expect(agent.getAutoMemoryDir()).toBe(memoryDir);
    expect(agent.getAutoMemoryContent()).toBe("Test memory content");
  });

  it("should truncate auto-memory content to 200 lines", async () => {
    const encodedPath = await pathEncoder.encode(workdir);
    const memoryDir = path.join(PROJECTS_DIRECTORY, encodedPath, "memory");
    const memoryFilePath = path.join(memoryDir, "MEMORY.md");

    await fs.mkdir(memoryDir, { recursive: true });
    const longContent = Array.from(
      { length: 250 },
      (_, i) => `Line ${i + 1}`,
    ).join("\n");
    await fs.writeFile(memoryFilePath, longContent, "utf-8");

    const agent = await Agent.create({
      workdir,
      autoMemoryEnabled: true,
    });

    const content = agent.getAutoMemoryContent();
    const lines = content.split("\n");
    expect(lines.length).toBe(200);
    expect(lines[0]).toBe("Line 1");
    expect(lines[199]).toBe("Line 200");
  });

  it("should respect WAVE_DISABLE_AUTO_MEMORY environment variable", async () => {
    process.env.WAVE_DISABLE_AUTO_MEMORY = "1";
    const agent = await Agent.create({
      workdir,
    });

    expect(agent.getAutoMemoryEnabled()).toBe(false);
    delete process.env.WAVE_DISABLE_AUTO_MEMORY;
  });

  it("should respect autoMemoryEnabled in settings.json", async () => {
    const waveDir = path.join(workdir, ".wave");
    await fs.mkdir(waveDir, { recursive: true });
    await fs.writeFile(
      path.join(waveDir, "settings.json"),
      JSON.stringify({ autoMemoryEnabled: false }),
      "utf-8",
    );

    const agent = await Agent.create({
      workdir,
    });

    expect(agent.getAutoMemoryEnabled()).toBe(false);
  });

  it("should consider auto-memory directory as part of the Safe Zone", async () => {
    const encodedPath = await pathEncoder.encode(workdir);
    const memoryDir = path.join(PROJECTS_DIRECTORY, encodedPath, "memory");
    const memoryFilePath = path.join(memoryDir, "MEMORY.md");

    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(memoryFilePath, "Test memory content", "utf-8");

    const agent = await Agent.create({
      workdir,
      autoMemoryEnabled: true,
    });

    // Check if memory directory is in Safe Zone
    const permissionManager = (
      agent as unknown as {
        permissionManager: {
          isInsideSafeZone: (path: string) => { isInside: boolean };
        };
      }
    ).permissionManager;
    const { isInside } = permissionManager.isInsideSafeZone(memoryFilePath);
    expect(isInside).toBe(true);

    // Check if a file outside is NOT in Safe Zone
    const outsideFile = path.join(os.tmpdir(), "outside.txt");
    const { isInside: isInsideOutside } =
      permissionManager.isInsideSafeZone(outsideFile);
    expect(isInsideOutside).toBe(false);
  });
});
