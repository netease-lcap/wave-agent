import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  GatewayConfig,
  ModelConfig,
  NextEditExcerpt,
  NextEditRegion,
} from "@/types/index.js";

const TEST_GATEWAY_CONFIG: GatewayConfig = {
  apiKey: "test-api-key",
  baseURL: "http://localhost:test",
};

const TEST_MODEL_CONFIG: ModelConfig = {
  model: "agent-model",
  fastModel: "fast-model",
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

function mockCreateWith(content: string) {
  const data = { choices: [{ message: { content }, finish_reason: "stop" }] };
  mockCreate.mockImplementation(() => ({
    withResponse: vi.fn().mockResolvedValue({
      data,
      response: { headers: new Map() },
    }),
    then: (resolve: (value: unknown) => void) => resolve(data),
  }));
}

/** Line 3 is the window the model may rewrite in the fixtures below. */
const EXCERPT: NextEditExcerpt = {
  startLine: 1,
  text: [
    "const a = 1;",
    "function f(id) {",
    "  return id;",
    "}",
    "export { f };",
  ].join("\n"),
};

const REGION: NextEditRegion = {
  startLine: 3,
  endLine: 3,
  text: "  return id;",
};

describe("AI Service - next edit suggestion", () => {
  let getNextEdit: typeof import("@/services/aiService.js").getNextEdit;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000);
    mockCreate.mockReset();
    const aiService = await import("@/services/aiService.js");
    getNextEdit = aiService.getNextEdit;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("serves the request from the completion model chain", async () => {
    mockCreateWith('{"startLine":3,"endLine":3,"text":"  return userId;"}');

    const result = await getNextEdit({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: {
        ...TEST_MODEL_CONFIG,
        completionModel: "completion-model",
      },
      edits: [{ oldText: "id", newText: "userId" }],
      region: REGION,
      excerpt: EXCERPT,
    });

    expect(mockCreate.mock.calls[0][0].model).toBe("completion-model");
    expect(result.model).toBe("completion-model");
    expect(result.suggestion).toEqual({
      startLine: 3,
      endLine: 3,
      text: "  return userId;",
    });
  });

  it("falls back to the fast model when no completion model is set", async () => {
    mockCreateWith("null");

    const result = await getNextEdit({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      edits: [],
      region: REGION,
      excerpt: EXCERPT,
    });

    expect(mockCreate.mock.calls[0][0].model).toBe("fast-model");
    expect(result.suggestion).toBeNull();
  });

  it("does not spend a model call when the switch is off", async () => {
    const result = await getNextEdit({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: { ...TEST_MODEL_CONFIG, nextEditEnabled: false },
      edits: [{ oldText: "id", newText: "userId" }],
      region: REGION,
      excerpt: EXCERPT,
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.suggestion).toBeNull();
  });

  it("ships the edit trajectory and the region in the prompt", async () => {
    mockCreateWith("null");

    await getNextEdit({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      edits: [{ oldText: "function f(id)", newText: "function f(userId)" }],
      region: REGION,
      excerpt: EXCERPT,
      language: "typescript",
      filePath: "/repo/a.ts",
    });

    const messages = mockCreate.mock.calls[0][0].messages;
    expect(messages[0].role).toBe("system");
    const user = messages[1].content as string;
    expect(user).toContain("- function f(id)");
    expect(user).toContain("+ function f(userId)");
    expect(user).toContain("3 |   return id;");
    expect(user).toContain("### Editable region: lines 3-3");
    expect(user).toContain("File: /repo/a.ts (typescript)");
  });

  it("treats a prose answer as no suggestion", async () => {
    mockCreateWith("I think you should rename the parameter.");

    const result = await getNextEdit({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      edits: [],
      region: REGION,
      excerpt: EXCERPT,
    });

    expect(result.suggestion).toBeNull();
  });

  it("rejects a range that leaves the region", async () => {
    mockCreateWith('{"startLine":1,"endLine":4,"text":"rewritten"}');

    const result = await getNextEdit({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      edits: [],
      region: REGION,
      excerpt: EXCERPT,
    });

    expect(result.suggestion).toBeNull();
  });

  it("supports deleting the region with an empty replacement", async () => {
    mockCreateWith('{"startLine":3,"endLine":3,"text":""}');

    const result = await getNextEdit({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      edits: [],
      region: REGION,
      excerpt: EXCERPT,
    });

    expect(result.suggestion).toEqual({ startLine: 3, endLine: 3, text: "" });
  });

  it("keeps parseNextEditAnswer tolerant of code fences and CRLF", async () => {
    const { parseNextEditAnswer } = await import("@/services/aiService.js");

    expect(
      parseNextEditAnswer(
        '```json\n{"startLine":3,"endLine":3,"text":"  return userId;\\r\\n"}\n```',
        REGION,
        EXCERPT,
      ),
    ).toEqual({ startLine: 3, endLine: 3, text: "  return userId;\n" });
  });

  it("returns no suggestion when the rewrite is identical to the current text", async () => {
    const { parseNextEditAnswer } = await import("@/services/aiService.js");

    expect(
      parseNextEditAnswer(
        '{"startLine":3,"endLine":3,"text":"  return id;"}',
        REGION,
        EXCERPT,
      ),
    ).toBeNull();
  });
});
