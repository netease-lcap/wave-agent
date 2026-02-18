import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  DEFAULT_SYSTEM_PROMPT,
} from "../../src/constants/prompts.js";
import { READ_TOOL_NAME, WRITE_TOOL_NAME } from "../../src/constants/tools.js";
import { ToolPlugin } from "../../src/tools/types.js";

describe("buildSystemPrompt", () => {
  it("should include tool-specific prompts when tools are present", () => {
    const tools = [
      {
        name: READ_TOOL_NAME,
        prompt: () => "Read for reading files",
      } as unknown as ToolPlugin,
      {
        name: WRITE_TOOL_NAME,
        prompt: () => "Write for creating files",
      } as unknown as ToolPlugin,
    ];
    const prompt = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, tools);
    expect(prompt).toContain("Read for reading files");
    expect(prompt).toContain("Write for creating files");
  });

  it("should exclude tool-specific prompts when tools are missing", () => {
    const tools = [
      {
        name: READ_TOOL_NAME,
        prompt: () => "Read for reading files",
      } as unknown as ToolPlugin,
    ];
    const prompt = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, tools);
    expect(prompt).toContain("Read for reading files");
    expect(prompt).not.toContain("Write for creating files");
  });
});
