import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import * as sessionService from "@/services/session.js";
import { createMockToolManager } from "../helpers/mockFactories.js";
import * as fs from "fs/promises";

// Mock dependencies
vi.mock("@/services/aiService");
vi.mock("@/services/session", async () => {
  const actual = await vi.importActual("@/services/session");
  return {
    ...actual,
    generateSessionId: vi.fn(() => "test-session-id"),
    handleSessionRestoration: vi.fn(),
    loadSessionFromJsonl: vi.fn(),
    appendMessages: vi.fn(),
  };
});
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
    vi.mocked(fs.readdir).mockResolvedValue([]);
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
        id: "main-123",
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
        id: "main",
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
});
