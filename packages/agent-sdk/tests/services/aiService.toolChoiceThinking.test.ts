import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Logger } from "@/types/core.js";
import type { GatewayConfig, ModelConfig } from "@/types/index.js";
import { clearGlobalLogger, setGlobalLogger } from "@/utils/globalLogger.js";

const TEST_GATEWAY_CONFIG: GatewayConfig = {
  apiKey: "test-api-key",
  baseURL: "http://localhost:test",
};

const TEST_MODEL_CONFIG: ModelConfig = {
  model: "agent-model",
  fastModel: "fast-model",
};

const FORCED_TOOL = {
  type: "function" as const,
  function: { name: "StructuredOutput" },
};

const mockCreate = vi.fn();

const mockOpenAI = {
  chat: {
    completions: {
      create: mockCreate,
    },
  },
};

vi.mock("@/utils/openaiClient.js", () => ({
  OpenAIClient: vi.fn().mockImplementation(function () {
    return mockOpenAI;
  }),
}));

function mockCreateWithResponse(content = "processed") {
  mockCreate.mockReturnValue({
    withResponse: vi.fn().mockResolvedValue({
      data: {
        choices: [{ message: { content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      },
      response: {
        headers: new Map([["content-type", "application/json"]]),
      },
    }),
  });
}

const warnSpy = vi.fn();

/**
 * The request-layer conflict rule (spec multi-agent/workflow.md「来自 agent 的
 * 结构化输出」场景 6): a FORCED `tool_choice` is demoted to "auto" while
 * extended thinking is on, and the request never fails because of the conflict.
 */
describe("AI Service - tool_choice demotion with extended thinking", () => {
  let callAgent: typeof import("@/services/aiService.js").callAgent;

  beforeEach(async () => {
    clearGlobalLogger();
    warnSpy.mockReset();
    setGlobalLogger({
      error: vi.fn(),
      warn: warnSpy,
      info: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger);
    mockCreate.mockReset();
    mockCreateWithResponse();
    const aiService = await import("@/services/aiService.js");
    callAgent = aiService.callAgent;
  });

  afterEach(() => {
    clearGlobalLogger();
  });

  /** `thinking` reaches the request through the model's options / disable params. */
  const thinkingModelConfig: ModelConfig = {
    ...TEST_MODEL_CONFIG,
    options: { thinking: { type: "enabled" } },
  };

  async function callWith(options: {
    modelConfig?: ModelConfig;
    toolChoice?:
      | "auto"
      | "none"
      | "required"
      | { type: "function"; function: { name: string } };
  }) {
    await callAgent({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: options.modelConfig ?? TEST_MODEL_CONFIG,
      messages: [{ role: "user", content: "Test message" }],
      workdir: "/test/workdir",
      toolChoice: options.toolChoice,
    });
    return mockCreate.mock.calls[0][0] as {
      tool_choice?: unknown;
      thinking?: unknown;
    };
  }

  it("demotes a named forced tool_choice to auto when thinking is active", async () => {
    const params = await callWith({
      modelConfig: thinkingModelConfig,
      toolChoice: FORCED_TOOL,
    });

    expect(params.thinking).toEqual({ type: "enabled" });
    expect(params.tool_choice).toBe("auto");
    expect(warnSpy).toHaveBeenCalledWith(
      "tool_choice {type:'function', name:'StructuredOutput'} demoted to auto: extended thinking is active",
    );
    // The request still went out (demotion, not a rejection)
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("demotes a bare 'required' tool_choice to auto when thinking is active", async () => {
    const params = await callWith({
      modelConfig: thinkingModelConfig,
      toolChoice: "required",
    });

    expect(params.tool_choice).toBe("auto");
    expect(warnSpy).toHaveBeenCalledWith(
      "tool_choice 'required' demoted to auto: extended thinking is active",
    );
  });

  it("demotes nothing when thinking is off", async () => {
    const params = await callWith({ toolChoice: FORCED_TOOL });

    expect(params.thinking).toBeUndefined();
    expect(params.tool_choice).toEqual(FORCED_TOOL);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("keeps an unforced 'auto' tool_choice untouched while thinking is active", async () => {
    const params = await callWith({
      modelConfig: thinkingModelConfig,
      toolChoice: "auto",
    });

    expect(params.tool_choice).toBe("auto");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("leaves tool_choice unset when the caller passes none", async () => {
    const params = await callWith({ modelConfig: thinkingModelConfig });

    expect(params.tool_choice).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("reads thinking from disableThinkingOptions too", async () => {
    // `{ type: "adaptive" }` is the other shape that counts as active.
    const params = await callAgent({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      messages: [{ role: "user", content: "Test message" }],
      workdir: "/test/workdir",
      disableThinkingOptions: { thinking: { type: "adaptive" } },
      toolChoice: FORCED_TOOL,
    }).then(() => mockCreate.mock.calls[0][0] as { tool_choice?: unknown });

    expect(params.tool_choice).toBe("auto");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("does not demote for a disabled thinking config", async () => {
    const params = await callAgent({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      messages: [{ role: "user", content: "Test message" }],
      workdir: "/test/workdir",
      disableThinkingOptions: { thinking: { type: "disabled" } },
      toolChoice: FORCED_TOOL,
    }).then(() => mockCreate.mock.calls[0][0] as { tool_choice?: unknown });

    expect(params.tool_choice).toEqual(FORCED_TOOL);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
