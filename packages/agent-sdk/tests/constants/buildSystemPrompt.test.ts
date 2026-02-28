import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  DEFAULT_SYSTEM_PROMPT,
  TOOL_POLICY,
} from "../../src/prompts/index.js";
import { READ_TOOL_NAME, WRITE_TOOL_NAME } from "../../src/constants/tools.js";
import { ToolPlugin } from "../../src/tools/types.js";

describe("buildSystemPrompt", () => {
  it("should include tool policy when tools are present", () => {
    const tools = [
      {
        name: READ_TOOL_NAME,
        prompt: () => "Read for reading files",
      } as unknown as ToolPlugin,
    ];
    const prompt = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, tools);
    expect(prompt).toContain(TOOL_POLICY);
  });

  it("should exclude tool policy when no tools are present", () => {
    const prompt = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, []);
    expect(prompt).not.toContain(TOOL_POLICY);
  });

  it("should NOT include tool-specific prompts when tools are present", () => {
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
    expect(prompt).not.toContain("Read for reading files");
    expect(prompt).not.toContain("Write for creating files");
  });
});
