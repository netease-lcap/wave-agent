import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import { Agent } from "@/agent.js";

const { getCompletionMock, recordCompletionOutcomeMock } = vi.hoisted(() => ({
  getCompletionMock: vi.fn(),
  recordCompletionOutcomeMock: vi.fn(),
}));

// Keep the rest of the metrics module real (the counters it records into are
// no-ops until telemetry initializes); only the family under test is a spy.
vi.mock("@/telemetry/metrics.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/telemetry/metrics.js")>();
  return { ...actual, recordCompletionOutcome: recordCompletionOutcomeMock };
});

vi.mock("@/services/aiService", () => ({
  getCompletion: getCompletionMock,
  callAgent: vi.fn(),
}));

// Isolate the test home under the OS temp dir so Agent.create's user config
// reads (e.g. ~/.wave/settings.json) stay hermetic.
vi.mock(import("os"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    homedir: vi.fn(() => "/tmp/wave-completion-outcome-homedir"),
    tmpdir: vi.fn(() => "/tmp"),
  };
});

const HOME = "/tmp/wave-completion-outcome-homedir";
const stdoutWrite = process.stdout.write;
const stderrWrite = process.stderr.write;

describe("Agent completion outcomes", () => {
  let agent: Agent | undefined;

  beforeEach(async () => {
    fs.rmSync(HOME, { recursive: true, force: true });
    process.stdout.write = vi.fn() as unknown as typeof process.stdout.write;
    process.stderr.write = vi.fn() as unknown as typeof process.stderr.write;
    vi.clearAllMocks();

    getCompletionMock.mockResolvedValue({ text: "42", model: "fast-model" });
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
    await agent!.getCompletion({
      prefix: "const answer = ",
      suffix: ";",
      filePath: "/repo/src/index.ts",
      language: "typescript",
    });

    agent!.reportCompletionOutcome("displayed");

    expect(recordCompletionOutcomeMock).toHaveBeenCalledWith(
      { outcome: "displayed", model: "fast-model", language: "typescript" },
      expect.anything(),
    );
  });

  it("counts an acceptance as its own event", async () => {
    await agent!.getCompletion({
      prefix: "",
      suffix: "",
      filePath: "/repo/src/index.ts",
    });

    agent!.reportCompletionOutcome("accepted");

    expect(recordCompletionOutcomeMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "accepted" }),
      expect.anything(),
    );
  });

  it("stays silent when no suggestion was ever produced", () => {
    agent!.reportCompletionOutcome("accepted");

    expect(recordCompletionOutcomeMock).not.toHaveBeenCalled();
  });

  it("drops the language when the file name cannot name one", async () => {
    await agent!.getCompletion({
      prefix: "",
      suffix: "",
      filePath: "/repo/notes.unknownext",
    });

    agent!.reportCompletionOutcome("displayed");

    expect(recordCompletionOutcomeMock).toHaveBeenCalledWith(
      { outcome: "displayed", model: "fast-model", language: undefined },
      expect.anything(),
    );
  });
});
