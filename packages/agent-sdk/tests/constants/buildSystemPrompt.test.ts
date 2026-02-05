import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  DEFAULT_SYSTEM_PROMPT,
} from "../../src/constants/prompts.js";
import {
  READ_TOOL_NAME,
  WRITE_TOOL_NAME,
  EDIT_TOOL_NAME,
  MULTI_EDIT_TOOL_NAME,
} from "../../src/constants/tools.js";

describe("buildSystemPrompt", () => {
  it("should include specific policies when tools are present", () => {
    const tools = [
      { name: READ_TOOL_NAME },
      { name: WRITE_TOOL_NAME },
      { name: EDIT_TOOL_NAME },
      { name: MULTI_EDIT_TOOL_NAME },
    ];
    const prompt = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, tools);
    expect(prompt).toContain("Write for creating files");
    expect(prompt).toContain("Edit/MultiEdit for editing");
    expect(prompt).toContain("Read for reading files");
    expect(prompt).toContain("Use specialized tools instead of bash commands");
  });

  it("should exclude Write policy when Write tool is missing", () => {
    const tools = [{ name: READ_TOOL_NAME }];
    const prompt = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, tools);
    expect(prompt).toContain("Read for reading files");
    expect(prompt).not.toContain("Write for creating files");
  });

  it("should exclude Edit/MultiEdit policy when both are missing", () => {
    const tools = [{ name: READ_TOOL_NAME }, { name: WRITE_TOOL_NAME }];
    const prompt = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, tools);
    expect(prompt).toContain("Read for reading files");
    expect(prompt).toContain("Write for creating files");
    expect(prompt).not.toContain("Edit/MultiEdit for editing");
  });

  it("should include Edit/MultiEdit policy if at least one is present", () => {
    const tools = [{ name: EDIT_TOOL_NAME }];
    const prompt = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, tools);
    expect(prompt).toContain("Edit/MultiEdit for editing");
  });
});
