import { describe, it, expect } from "vitest";
import type { Message } from "wave-agent-sdk";
import { renderTranscriptPlainText } from "../../src/utils/exportRenderer.js";

const TIMESTAMP = "2026-01-02T03:04:05.000Z";

const userMessage = (content: string, id = "m1"): Message => ({
  id,
  role: "user",
  timestamp: TIMESTAMP,
  blocks: [{ type: "text", content, stage: "end" }],
});

const assistantMessage = (blocks: Message["blocks"], id = "m2"): Message => ({
  id,
  role: "assistant",
  timestamp: TIMESTAMP,
  blocks,
});

describe("renderTranscriptPlainText", () => {
  it("keeps the conversation text as-is, without ANSI escapes", async () => {
    const text = await renderTranscriptPlainText([
      userMessage("帮我看看 README 里的安装步骤"),
      assistantMessage([
        { type: "text", content: "README.md 里写着：", stage: "end" },
      ]),
    ]);

    expect(text).toContain("帮我看看 README 里的安装步骤");
    expect(text).toContain("README.md 里写着：");
    // 字符码拼出来的 ESC，避免正则字面量里的控制字符（no-control-regex）。
    expect(text.includes(String.fromCharCode(27))).toBe(false);
  });

  it("renders tool calls with their parameters and result", async () => {
    const text = await renderTranscriptPlainText([
      assistantMessage([
        {
          type: "tool",
          name: "Read",
          parameters: '{"file_path":"README.md"}',
          result: "boom",
          stage: "end",
          success: false,
          error: "Error: command not found: pnpm",
        },
      ]),
    ]);

    expect(text).toContain("Read");
    expect(text).toContain('{"file_path":"README.md"}');
    expect(text).toContain("boom");
  });

  it("skips isMeta messages, which the terminal never shows either", async () => {
    const meta: Message = {
      ...userMessage("SYSTEM-ONLY NOTE", "m9"),
      isMeta: true,
    };
    const text = await renderTranscriptPlainText([
      userMessage("visible question"),
      meta,
    ]);

    expect(text).toContain("visible question");
    expect(text).not.toContain("SYSTEM-ONLY NOTE");
  });

  it("ends with exactly one newline", async () => {
    const text = await renderTranscriptPlainText([userMessage("hi")]);

    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    expect(text.startsWith("\n")).toBe(false);
  });

  it("returns just a newline for an empty thread", async () => {
    expect(await renderTranscriptPlainText([])).toBe("\n");
  });
});
