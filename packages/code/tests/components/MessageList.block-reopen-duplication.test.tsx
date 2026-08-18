import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MessageList } from "../../src/components/MessageList.js";
import { useTasks } from "../../src/hooks/useTasks.js";
import { ChatContextType, useChat } from "../../src/contexts/useChat.js";
import type { Message, MessageBlock } from "wave-agent-sdk";

vi.mock("ink", async () => {
  const actual = await vi.importActual("ink");
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

vi.mock("../../src/hooks/useTasks.js", () => ({
  useTasks: vi.fn(),
}));

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: vi.fn(),
}));

describe("MessageList block reopen duplication", () => {
  beforeEach(() => {
    vi.mocked(useTasks).mockReturnValue([]);
    vi.mocked(useChat).mockReturnValue({
      isTaskListVisible: true,
    } as unknown as ChatContextType);
  });

  const msg = (id: string, blocks: MessageBlock[]): Message => ({
    id,
    role: "assistant",
    blocks,
    timestamp: new Date().toISOString(),
  });

  const r = (content: string, stage: "streaming" | "end"): MessageBlock => ({
    type: "reasoning",
    content,
    stage,
  });
  const t = (content: string, stage: "streaming" | "end"): MessageBlock => ({
    type: "text",
    content,
    stage,
  });
  const tool = (stage: string, id = "tool-1"): MessageBlock =>
    ({
      type: "tool",
      id,
      name: "Grep",
      parameters: '{"path":"/tmp"}',
      compactParams: "Grep /tmp",
      stage,
      success: true,
    }) as unknown as MessageBlock;

  const countOccurrences = (frame: string, needle: string): number =>
    frame.split(needle).length - 1;

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  // When a text/reasoning block reopens (stage "end" -> "streaming") it
  // migrates from Ink's append-only <Static> zone back to the dynamic zone.
  // The frozen prefix stays on screen while the dynamic render re-displays the
  // full accumulated content, so the first words appear twice. Regression:
  // every frame must show each block content at most once.
  const runStages = async (stages: MessageBlock[][]) => {
    const { rerender, frames } = render(
      <MessageList messages={[msg("m1", stages[0])]} isExpanded={false} />,
    );
    await flush();
    for (let i = 1; i < stages.length; i++) {
      rerender(
        <MessageList messages={[msg("m1", stages[i])]} isExpanded={false} />,
      );
      await flush();
    }
    return frames;
  };

  const expectAtMostOnce = (frames: string[], needles: string[]) => {
    for (const [i, frame] of frames.entries()) {
      for (const needle of needles) {
        expect(
          countOccurrences(frame, needle),
          `frame ${i} contains "${needle}" more than once:\n${frame}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  };

  it("reasoning block reopen after tool does not duplicate frozen prefix", async () => {
    // R1 streams -> T1 streams (R finalized) -> tool runs/completes -> R2
    // arrives and reopens the finalized reasoning block -> re-finalizes -> end
    const stages: MessageBlock[][] = [
      [r("Think step one", "streaming")],
      [r("Think step one", "end"), t("Answer text", "streaming")],
      [
        r("Think step one", "end"),
        t("Answer text", "streaming"),
        tool("running"),
      ],
      [r("Think step one", "end"), t("Answer text", "streaming"), tool("end")],
      [
        r("Think step one Think step two", "streaming"),
        t("Answer text", "end"),
        tool("end"),
      ],
      [
        r("Think step one Think step two", "end"),
        t("Answer text", "streaming"),
        tool("end"),
      ],
      [
        r("Think step one Think step two", "end"),
        t("Answer text", "end"),
        tool("end"),
      ],
    ];

    const frames = await runStages(stages);
    expectAtMostOnce(frames, ["Think step one", "Answer text", "Grep /tmp"]);
    const final = frames[frames.length - 1];
    expect(countOccurrences(final, "Think step one")).toBe(1);
    expect(countOccurrences(final, "Answer text")).toBe(1);
  });

  it("text block reopen after reasoning does not duplicate first words", async () => {
    // The reported symptom: reasoning streams after the text has started, then
    // the text resumes — the text block reopens and its already-displayed first
    // words are rendered again by the dynamic zone.
    const stages: MessageBlock[][] = [
      [t("The answer", "streaming")],
      [t("The answer", "end"), r("Let me think", "streaming")],
      [t("The answer is 42", "streaming"), r("Let me think", "end")],
      [t("The answer is 42", "end"), r("Let me think", "end")],
    ];

    const frames = await runStages(stages);
    expectAtMostOnce(frames, ["The answer", "Let me think"]);
    const final = frames[frames.length - 1];
    expect(countOccurrences(final, "The answer")).toBe(1);
  });

  it("reopened block streams new content without overlapping the frozen prefix", async () => {
    // During the reopen window the dynamic zone must render only the delta
    // (content beyond the frozen prefix), so the new reasoning suffix is
    // visible while the already-displayed prefix is not repeated.
    const stages: MessageBlock[][] = [
      [r("Think step one", "streaming")],
      [r("Think step one", "end"), t("Answer text", "streaming")],
      [r("Think step one", "end"), t("Answer text", "end")],
      [
        r("Think step one Think step two", "streaming"),
        t("Answer text", "end"),
      ],
      [r("Think step one Think step two", "end"), t("Answer text", "end")],
    ];

    const frames = await runStages(stages);
    // The reopen-streaming frame (index for stage 3) must show the suffix
    // "Think step two" (via the delta) but never the repeated prefix.
    const reopenFrame = frames.findIndex((f) => f.includes("Think step two"));
    expect(reopenFrame).toBeGreaterThan(-1);
    expect(countOccurrences(frames[reopenFrame], "Think step one")).toBe(1);
    expect(countOccurrences(frames[reopenFrame], "Think step two")).toBe(1);
  });
});
