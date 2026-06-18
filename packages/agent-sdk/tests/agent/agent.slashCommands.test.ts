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

    // Verify that commands are returned as an array
    // Built-in commands were moved to CLI; SDK starts with no commands
    expect(commands).toBeDefined();
    expect(Array.isArray(commands)).toBe(true);

    await agent.destroy();
  });
});
