/**
 * Streaming race integration tests (Agent-level, real message pipeline).
 *
 * Regresses the streaming delta-contract bugs fixed in #1672/#1755-area
 * (SDK streaming callbacks carry chunk deltas, and content/tool updates can
 * interleave within one assistant turn):
 * - interleaved onContentUpdate/onToolUpdate must reassemble into complete,
 *   correctly-ordered message blocks (no lost or duplicated deltas)
 * - text streamed AFTER a tool call must still land in the assistant message
 *
 * aiService.callAgent is mocked to emit the streaming callback sequence; the
 * Agent, message manager, tool loop and message conversion are all real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { Agent } from "../../src/agent.js";
import * as aiService from "../../src/services/aiService.js";
import { createMockToolManager } from "../helpers/mockFactories.js";

vi.mock("../../src/services/aiService.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/services/aiService.js")>();
  return {
    ...actual,
    callAgent: vi.fn(),
  };
});

describe("Streaming message race (interleaved content and tool deltas)", () => {
  let agent: Agent;
  let workdir: string;
  let callAgent: ReturnType<typeof vi.fn>;
  const mockToolManager = createMockToolManager();

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-stream-race-"));
    callAgent = vi.mocked(aiService.callAgent);
    callAgent.mockClear();
    mockToolManager.execute.mockReset();

    agent = await Agent.create({
      apiKey: "test-key",
      workdir,
    });
    const container = (
      agent as unknown as {
        container: { register: (n: string, v: unknown) => void };
      }
    ).container;
    container.register("ToolManager", mockToolManager.instance);
  });

  afterEach(async () => {
    await agent.destroy();
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("reassembles interleaved content and tool parameter deltas without loss", async () => {
    let aiCallCount = 0;
    callAgent.mockImplementation(
      async (options: {
        onContentUpdate?: (c: string) => void;
        onToolUpdate?: (u: {
          id: string;
          name: string;
          parametersChunk: string;
          stage: string;
        }) => void;
      }) => {
        aiCallCount++;
        if (aiCallCount === 1) {
          // Content chunks interleaved with tool parameter chunks, the way an
          // SSE stream delivers them for a model that narrates while calling.
          options.onContentUpdate?.("Let me");
          options.onContentUpdate?.("Let me check");
          options.onToolUpdate?.({
            id: "call_race",
            name: "run_terminal_cmd",
            parametersChunk: '{"co',
            stage: "streaming",
          });
          options.onToolUpdate?.({
            id: "call_race",
            name: "run_terminal_cmd",
            parametersChunk: 'mmand": "pwd"}',
            stage: "streaming",
          });
          return {
            content: "Let me check",
            tool_calls: [
              {
                id: "call_race",
                type: "function" as const,
                index: 0,
                function: {
                  name: "run_terminal_cmd",
                  arguments: JSON.stringify({ command: "pwd" }),
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          };
        }
        // Second turn: content streamed in two deltas after the tool ran.
        options.onContentUpdate?.("Done");
        options.onContentUpdate?.("Done: file.txt");
        return {
          content: "Done: file.txt",
          usage: {
            prompt_tokens: 20,
            completion_tokens: 5,
            total_tokens: 25,
          },
        };
      },
    );

    mockToolManager.execute.mockResolvedValue({
      success: true,
      content: "/tmp",
      shortResult: "pwd ok",
    });

    await agent.sendMessage("What directory am I in?");

    // Tool executed exactly once through the real tool loop.
    expect(mockToolManager.execute).toHaveBeenCalledTimes(1);
    expect(mockToolManager.execute).toHaveBeenCalledWith(
      "run_terminal_cmd",
      { command: "pwd" },
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    );

    // Message sequence: user → assistant(text+tool) → tool result → assistant.
    const roles = agent.messages.map((m) => m.role);
    expect(roles.slice(0, 2)).toEqual(["user", "assistant"]);

    const assistantMessages = agent.messages.filter(
      (m) => m.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(2);

    // First assistant message: text before the tool call, complete.
    const firstAssistant = assistantMessages[0];
    const textBlock = firstAssistant.blocks.find((b) => b.type === "text");
    expect(textBlock && (textBlock as { content: string }).content).toBe(
      "Let me check",
    );

    // Tool block: parameters reassembled from the two chunks.
    const toolBlock = firstAssistant.blocks.find((b) => b.type === "tool");
    expect(toolBlock).toBeDefined();
    expect((toolBlock as { id: string; name: string }).id).toBe("call_race");
    expect((toolBlock as { id: string; name: string }).name).toBe(
      "run_terminal_cmd",
    );
    // Parameters reassembled from the two chunks; the tool loop re-serializes
    // them (compact JSON), so compare parsed objects.
    expect(
      JSON.parse((toolBlock as { parameters: string }).parameters),
    ).toEqual({ command: "pwd" });

    // Second assistant message: content streamed in deltas after the tool.
    const secondAssistant = assistantMessages[1];
    const secondText = secondAssistant.blocks.find((b) => b.type === "text");
    expect(secondText && (secondText as { content: string }).content).toBe(
      "Done: file.txt",
    );
  });

  it("keeps content streamed after a tool call inside the same assistant message", async () => {
    let aiCallCount = 0;
    callAgent.mockImplementation(
      async (options: {
        onContentUpdate?: (c: string) => void;
        onToolUpdate?: (u: {
          id: string;
          name: string;
          parametersChunk: string;
          stage: string;
        }) => void;
      }) => {
        aiCallCount++;
        if (aiCallCount === 1) {
          // Tool block appears first, then the model keeps narrating — the
          // trickier interleaving order for message block assembly.
          options.onToolUpdate?.({
            id: "call_after",
            name: "run_terminal_cmd",
            parametersChunk: '{"command": "ls"}',
            stage: "streaming",
          });
          options.onContentUpdate?.("I found it: ");
          return {
            content: "I found it: ",
            tool_calls: [
              {
                id: "call_after",
                type: "function" as const,
                index: 0,
                function: {
                  name: "run_terminal_cmd",
                  arguments: JSON.stringify({ command: "ls" }),
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          };
        }
        return {
          content: "Done.",
          usage: {
            prompt_tokens: 20,
            completion_tokens: 5,
            total_tokens: 25,
          },
        };
      },
    );

    mockToolManager.execute.mockResolvedValue({
      success: true,
      content: "file.txt",
      shortResult: "ls ok",
    });

    await agent.sendMessage("List the directory");

    const assistantMessages = agent.messages.filter(
      (m) => m.role === "assistant",
    );
    const firstAssistant = assistantMessages[0];

    // Both blocks exist: the tool block created by onToolUpdate and the text
    // block created later by onContentUpdate.
    const toolBlock = firstAssistant.blocks.find((b) => b.type === "tool");
    const textBlock = firstAssistant.blocks.find((b) => b.type === "text");
    expect(toolBlock).toBeDefined();
    expect(textBlock).toBeDefined();
    expect((textBlock as { content: string }).content).toBe("I found it: ");
    expect(
      JSON.parse((toolBlock as { parameters: string }).parameters),
    ).toEqual({ command: "ls" });
  });
});
