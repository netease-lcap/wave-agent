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
