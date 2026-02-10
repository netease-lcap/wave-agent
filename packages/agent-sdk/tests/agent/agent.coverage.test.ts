import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import * as memory from "@/services/memory.js";
import * as sessionService from "@/services/session.js";
import { createMockToolManager } from "../helpers/mockFactories.js";
import * as fs from "fs/promises";

// Mock dependencies
vi.mock("@/services/aiService");
vi.mock("@/services/session");
vi.mock("fs/promises");

const { instance: mockToolManagerInstance } = createMockToolManager();
vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return mockToolManagerInstance;
  }),
}));

describe("Agent - Branch Coverage", () => {
  let agent: Agent;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(fs.readFile).mockResolvedValue("");
    // Default session restoration mock
    vi.mocked(sessionService.handleSessionRestoration).mockResolvedValue(
      undefined,
    );
  });

  afterEach(async () => {
    if (agent) await agent.destroy();
  });

  describe("Initialization and Configuration", () => {
    it("should handle missing project and user memory files", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));

      agent = await Agent.create({ workdir: "/test/workdir" });

      expect(agent.projectMemory).toBe("");
      expect(agent.userMemory).toBe("");
    });

    it("should use provided lspManager", async () => {
      const mockLspManager = {
        initialize: vi.fn(),
        cleanup: vi.fn(),
      };

      agent = await Agent.create({
        lspManager: mockLspManager as unknown as Agent["lspManager"],
      });
      // Accessing private property via any for verification
      expect((agent as unknown as { lspManager: unknown }).lspManager).toBe(
        mockLspManager,
      );
    });
  });

  describe("Session Restoration", () => {
    it("should restore subagent sessions if present in messages", async () => {
      const mockMessages = [
        {
          role: "assistant",
          content: "Running subagent",
          blocks: [
            {
              type: "subagent",
              sessionId: "sub-123",
              subagentId: "researcher",
              configuration: { name: "researcher" },
            },
          ],
        },
      ];

      vi.mocked(sessionService.handleSessionRestoration).mockResolvedValue({
        sessionId: "main-123",
        messages: mockMessages as unknown as Parameters<
          typeof sessionService.appendMessages
        >[1],
        workdir: "/test",
        metadata: { latestTotalTokens: 100 },
      } as unknown as Awaited<
        ReturnType<typeof sessionService.handleSessionRestoration>
      >);

      vi.mocked(sessionService.loadSessionFromJsonl).mockResolvedValue({
        id: "sub-123",
        messages: [],
        metadata: {
          workdir: "/test",
          lastActiveAt: new Date().toISOString(),
          latestTotalTokens: 0,
        },
      });

      agent = await Agent.create({});

      expect(sessionService.loadSessionFromJsonl).toHaveBeenCalledWith(
        "sub-123",
        expect.any(String),
        "subagent",
      );
    });

    it("should handle subagent session restoration failure gracefully", async () => {
      const mockMessages = [
        {
          role: "assistant",
          blocks: [
            {
              type: "subagent",
              sessionId: "sub-fail",
              subagentId: "id",
              configuration: {},
            },
          ],
        },
      ];
      vi.mocked(sessionService.handleSessionRestoration).mockResolvedValue({
        sessionId: "main",
        messages: mockMessages as unknown as Parameters<
          typeof sessionService.appendMessages
        >[1],
        workdir: "/test",
        metadata: { latestTotalTokens: 100 },
      } as unknown as Awaited<
        ReturnType<typeof sessionService.handleSessionRestoration>
      >);
      vi.mocked(sessionService.loadSessionFromJsonl).mockRejectedValue(
        new Error("Load failed"),
      );

      agent = await Agent.create({});
      // Should not throw
      expect(agent).toBeDefined();
    });
  });

  describe("Public Methods and Edge Cases", () => {
    beforeEach(async () => {
      agent = await Agent.create({});
    });

    it("should return null for background shell output if task not found", () => {
      expect(agent.getBackgroundShellOutput("non-existent")).toBeNull();
    });

    it("should return null for background task output if task not found", () => {
      expect(agent.getBackgroundTaskOutput("non-existent")).toBeNull();
    });

    it("should handle restoreSession with same sessionId", async () => {
      const currentId = agent.sessionId;
      await agent.restoreSession(currentId);
      expect(sessionService.loadSessionFromJsonl).not.toHaveBeenCalled();
    });

    it("should throw error if restoreSession target not found", async () => {
      vi.mocked(sessionService.loadSessionFromJsonl).mockResolvedValue(null);
      await expect(agent.restoreSession("missing")).rejects.toThrow(
        "Session not found: missing",
      );
    });

    it("should handle slash command that doesn't exist", async () => {
      // Mock slashCommandManager.parseAndValidateSlashCommand
      const mockSlashManager = (
        agent as unknown as {
          slashCommandManager: {
            parseAndValidateSlashCommand: (cmd: string) => { isValid: boolean };
          };
        }
      ).slashCommandManager;
      vi.spyOn(
        mockSlashManager,
        "parseAndValidateSlashCommand",
      ).mockReturnValue({ isValid: false });

      const spyAddUserMessage = vi.spyOn(
        (
          agent as unknown as {
            messageManager: { addUserMessage: (msg: string) => void };
          }
        ).messageManager,
        "addUserMessage",
      );

      await agent.sendMessage("/unknown");

      expect(spyAddUserMessage).toHaveBeenCalled();
    });

    it("should handle empty or single slash command", async () => {
      const spyAddUserMessage = vi.spyOn(
        (
          agent as unknown as {
            messageManager: { addUserMessage: (msg: string) => void };
          }
        ).messageManager,
        "addUserMessage",
      );
      await agent.sendMessage("/");
      expect(spyAddUserMessage).not.toHaveBeenCalled();

      await agent.sendMessage("  ");
      // sendMessage doesn't check for empty string if it doesn't start with /
      // but let's see
    });
  });

  describe("Memory Saving", () => {
    beforeEach(async () => {
      agent = await Agent.create({ workdir: "/test/workdir" });
      // Add an assistant message to attach memory blocks to
      (
        agent as unknown as {
          messageManager: { setMessages: (msgs: unknown[]) => void };
        }
      ).messageManager.setMessages([{ role: "assistant", blocks: [] }]);
    });

    it("should format memory message with # if missing", async () => {
      const spyAddMemory = vi
        .spyOn(memory, "addMemory")
        .mockResolvedValue(undefined);
      await agent.saveMemory("test memory", "project");
      expect(spyAddMemory).toHaveBeenCalledWith(
        "#test memory",
        expect.any(String),
      );
    });

    it("should handle memory save failure", async () => {
      vi.spyOn(memory, "addMemory").mockRejectedValue(new Error("Save failed"));
      await agent.saveMemory("test", "project");

      const lastMsg = agent.messages[0];
      const block = lastMsg.blocks[0];
      if (block.type === "memory") {
        expect(block.isSuccess).toBe(false);
        expect(block.content).toContain("Error: Save failed");
      } else {
        throw new Error("Expected memory block");
      }
    });
  });
});
