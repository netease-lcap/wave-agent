import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../../src/agent.js";
import { ToolManager } from "../../src/managers/toolManager.js";

// Mock dependencies that Agent.create needs
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn().mockResolvedValue(""),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      access: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      stat: vi
        .fn()
        .mockResolvedValue({ isFile: () => true, isDirectory: () => false }),
    },
  };
});

describe("Agent Tool Selection Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize agent with all tools by default", async () => {
    const agent = await Agent.create({
      apiKey: "test-key",
    });

    // Access private toolManager for verification
    const toolManager = (agent as unknown as { toolManager: ToolManager })
      .toolManager;
    const tools = toolManager.list().map((t) => t.name);

    expect(tools).toContain("Bash");
    expect(tools).toContain("Read");
    expect(tools).toContain("Write");
    expect(tools).toContain("Edit");
    expect(tools).toContain("Task");
  });

  it("should initialize agent with specific tools", async () => {
    const agent = await Agent.create({
      apiKey: "test-key",
      tools: ["Read", "Edit"],
    });

    const toolManager = (agent as unknown as { toolManager: ToolManager })
      .toolManager;
    const tools = toolManager.list().map((t) => t.name);

    expect(tools).toContain("Read");
    expect(tools).toContain("Edit");
    expect(tools).not.toContain("Bash");
    expect(tools).not.toContain("Write");
    expect(tools).not.toContain("Task");
  });

  it("should initialize agent with no tools when tools is empty array", async () => {
    const agent = await Agent.create({
      apiKey: "test-key",
      tools: [],
    });

    const toolManager = (agent as unknown as { toolManager: ToolManager })
      .toolManager;
    const tools = toolManager.list();

    expect(tools).toHaveLength(0);
  });
});
