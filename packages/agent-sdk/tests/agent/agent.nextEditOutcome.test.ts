import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import { Agent } from "@/agent.js";

const {
  getNextEditMock,
  recordNextEditOutcomeMock,
  recordCompletionOutcomeMock,
} = vi.hoisted(() => ({
  getNextEditMock: vi.fn(),
  recordNextEditOutcomeMock: vi.fn(),
  recordCompletionOutcomeMock: vi.fn(),
}));

// Only the family under test is a spy; the counters the rest of the module
// records into are no-ops until telemetry initializes.
vi.mock("@/telemetry/metrics.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/telemetry/metrics.js")>();
  return {
    ...actual,
    recordNextEditOutcome: recordNextEditOutcomeMock,
    recordCompletionOutcome: recordCompletionOutcomeMock,
  };
});

vi.mock("@/services/aiService", () => ({
  getNextEdit: getNextEditMock,
  callAgent: vi.fn(),
}));

vi.mock(import("os"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    homedir: vi.fn(() => "/tmp/wave-next-edit-outcome-homedir"),
    tmpdir: vi.fn(() => "/tmp"),
  };
});

const HOME = "/tmp/wave-next-edit-outcome-homedir";
const stdoutWrite = process.stdout.write;
const stderrWrite = process.stderr.write;

const REGION = { startLine: 3, endLine: 3, text: "  return id;" };

describe("Agent next edit outcomes", () => {
  let agent: Agent | undefined;

  beforeEach(async () => {
    fs.rmSync(HOME, { recursive: true, force: true });
    process.stdout.write = vi.fn() as unknown as typeof process.stdout.write;
    process.stderr.write = vi.fn() as unknown as typeof process.stderr.write;
    vi.clearAllMocks();

    getNextEditMock.mockResolvedValue({
      suggestion: { startLine: 3, endLine: 3, text: "  return userId;" },
      model: "flash-model",
    });
    agent = await Agent.create({ workdir: `${HOME}/workdir` });
  });

  afterEach(async () => {
    if (agent) {
      await agent.destroy();
      agent = undefined;
    }
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
    vi.clearAllMocks();
  });

  it("attributes the outcome to the model and the language of the suggestion", async () => {
    await agent!.getNextEdit({
      edits: [{ oldText: "id", newText: "userId" }],
      region: REGION,
      excerpt: { startLine: 1, text: "function f(id) {\n  return id;\n}" },
      language: "typescript",
      filePath: "/repo/src/index.ts",
    });

    agent!.reportNextEditOutcome("displayed");

    expect(recordNextEditOutcomeMock).toHaveBeenCalledWith(
      { outcome: "displayed", model: "flash-model", language: "typescript" },
      expect.anything(),
    );
  });

  it("counts an acceptance as its own event", async () => {
    await agent!.getNextEdit({
      edits: [],
      region: REGION,
      excerpt: { startLine: 1, text: "" },
      filePath: "/repo/src/index.ts",
    });

    agent!.reportNextEditOutcome("accepted");

    expect(recordNextEditOutcomeMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "accepted" }),
      expect.anything(),
    );
  });

  it("stays silent when no suggestion was ever requested", () => {
    agent!.reportNextEditOutcome("accepted");

    expect(recordNextEditOutcomeMock).not.toHaveBeenCalled();
  });

  it("does not touch the completion series", async () => {
    await agent!.getNextEdit({
      edits: [],
      region: REGION,
      excerpt: { startLine: 1, text: "" },
      filePath: "/repo/src/index.ts",
    });

    agent!.reportNextEditOutcome("displayed");

    // Two capabilities, two denominators: a rewrite must never land in the
    // caret-completion rate (spec ui/next-edit-suggestion.md 故事 7).
    expect(recordNextEditOutcomeMock).toHaveBeenCalledTimes(1);
    expect(recordCompletionOutcomeMock).not.toHaveBeenCalled();
  });
});
