import { describe, it, expect, vi } from "vitest";
import { Agent } from "@/agent.js";
import { createMockToolManager } from "../helpers/mockFactories.js";

// Mock the toolManager
const { instance: mockToolManagerInstance } = createMockToolManager();

vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return mockToolManagerInstance;
  }),
}));

// Mock logger
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock memory manager
vi.mock("@/services/memoryManager", () => ({
  createMemoryManager: vi.fn().mockImplementation(function () {
    return {
      getUserMemoryContent: vi.fn().mockResolvedValue(""),
    };
  }),
}));

// Mock custom commands loader to avoid FS access
vi.mock("@/utils/customCommands", () => ({
  loadCustomSlashCommands: vi.fn().mockReturnValue([]),
}));

describe("Agent - Slash Commands Readiness", () => {
  it("should have slash commands ready immediately after Agent.create", async () => {
    const agent = await Agent.create({
      apiKey: "test-key",
      workdir: "/tmp/test-slash-commands",
    });

    const commands = agent.getSlashCommands();

    // Verify that commands are returned and not empty
    // Built-in 'init' command should always be present
    expect(commands).toBeDefined();
    expect(Array.isArray(commands)).toBe(true);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.some((c) => c.name === "init")).toBe(true);

    await agent.destroy();
  });
});
