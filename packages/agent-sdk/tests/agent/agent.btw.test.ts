import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import { Agent } from "@/agent.js";
import type { AgentCallbacks } from "@/types/index.js";

const { callAgentMock } = vi.hoisted(() => ({
  callAgentMock: vi.fn(),
}));

const { mockMemoryServiceInstance } = vi.hoisted(() => ({
  mockMemoryServiceInstance: {
    getUserMemoryContent: vi.fn().mockResolvedValue(""),
    ensureUserMemoryFile: vi.fn().mockResolvedValue(undefined),
    readMemoryFile: vi.fn().mockResolvedValue(""),
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
    clearCache: vi.fn(),
  },
}));

vi.mock("@/services/memory", () => ({
  MemoryService: vi.fn().mockImplementation(function () {
    return mockMemoryServiceInstance;
  }),
}));

// Isolate the test home under the OS temp dir so Agent.create's user config
// reads (e.g. ~/.wave/settings.json) stay hermetic.
vi.mock(import("os"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    homedir: vi.fn(() => "/tmp/wave-btw-test-homedir"),
    tmpdir: vi.fn(() => "/tmp"),
  };
});

vi.mock("@/services/aiService", () => ({
  callAgent: callAgentMock,
}));

// Suppress stdout/stderr during tests.
const stdoutWrite = process.stdout.write;
const stderrWrite = process.stderr.write;
const BTW_HOME = "/tmp/wave-btw-test-homedir";

describe("Agent askBtw", () => {
  let agent: Agent;
  let mockCallbacks: AgentCallbacks;

  beforeEach(async () => {
    // Start from a clean isolated home.
    fs.rmSync(BTW_HOME, { recursive: true, force: true });
    process.stdout.write = vi.fn() as unknown as typeof process.stdout.write;
    process.stderr.write = vi.fn() as unknown as typeof process.stderr.write;
    vi.clearAllMocks();
    callAgentMock.mockResolvedValue({
      content: "Side answer",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      tool_calls: [],
    });

    mockCallbacks = {};

    agent = await Agent.create({
      workdir: `${BTW_HOME}/workdir`,
      callbacks: mockCallbacks,
    });
  });

  afterEach(async () => {
    if (agent) {
      await agent.destroy();
    }
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
    vi.clearAllMocks();
  });

  it("should route to the fork and return the answer", async () => {
    const answer = await agent.askBtw("What is the plan?");

    expect(answer).toBe("Side answer");
    expect(callAgentMock).toHaveBeenCalledTimes(1);
    // The fork passes the main model config (no fast-model override) so the
    // prompt cache is reused.
    expect(callAgentMock.mock.calls[0][0].model).toBeUndefined();
  });

  it("should return the tool_use rejection message as the answer", async () => {
    callAgentMock.mockResolvedValueOnce({
      content: "",
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "Read", arguments: "{}" },
        },
      ],
    });

    const answer = await agent.askBtw("What is in /tmp?");

    expect(answer).toBe(
      "(The model tried to call Read instead of answering directly. Try rephrasing or ask in the main conversation.)",
    );
  });

  it("should propagate aborts as thrown errors", async () => {
    const abortController = new AbortController();
    callAgentMock.mockRejectedValueOnce(new Error("Request was aborted"));
    abortController.abort();

    await expect(
      agent.askBtw("Question?", abortController.signal),
    ).rejects.toThrow("Request was aborted");
  });
});
