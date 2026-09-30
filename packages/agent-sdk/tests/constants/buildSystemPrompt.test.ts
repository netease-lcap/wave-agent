import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildUsingToolsPrompt,
  DEFAULT_SYSTEM_PROMPT,
  DOING_TASKS_PROMPT,
  LEAN_SYSTEM_PROMPT,
  SECURITY_NOTE,
  SYSTEM_PROMPT,
  TONE_AND_STYLE_PROMPT,
  URL_GUARD,
  type SystemPromptBlock,
} from "../../src/prompts/index.js";
import {
  BASH_TOOL_NAME,
  READ_TOOL_NAME,
  TASK_CREATE_TOOL_NAME,
  WRITE_TOOL_NAME,
} from "../../src/constants/tools.js";
import { ToolPlugin } from "../../src/tools/types.js";

/** Flatten SystemPromptBlock[] into a single string for string-based assertions */
function flattenBlocks(blocks: SystemPromptBlock[]): string {
  return blocks.map((b) => b.text).join("\n\n");
}

const TOOLS_HEADER = "# Using your tools";

function tool(name: string): ToolPlugin {
  return { name, prompt: () => `${name} prompt` } as unknown as ToolPlugin;
}

describe("buildSystemPrompt", () => {
  it("should include the tools section when tools are present", () => {
    const tools = [tool(READ_TOOL_NAME)];
    const prompt = flattenBlocks(
      buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, tools),
    );
    expect(prompt).toContain(buildUsingToolsPrompt(tools));
  });

  it("should exclude the tools section when no tools are present", () => {
    const prompt = flattenBlocks(buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, []));
    expect(prompt).not.toContain(TOOLS_HEADER);
  });

  it("should NOT include tool-specific prompts when tools are present", () => {
    const tools = [tool(READ_TOOL_NAME), tool(WRITE_TOOL_NAME)];
    const prompt = flattenBlocks(
      buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, tools),
    );
    expect(prompt).not.toContain("Read prompt");
    expect(prompt).not.toContain("Write prompt");
  });

  it("never carries MCP usage notes in any block", () => {
    // A server's usage notes are announced as a message when the server becomes
    // usable, not put into the prompt: they appear only when a connection
    // happens, and that must not rewrite the cached prefix
    // (docs/specs/ecosystem/mcp.md, docs/specs/core/prompt-cache-control.md).
    const blocks = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, []);
    const prompt = flattenBlocks(blocks);

    expect(prompt).not.toContain("<mcp_instructions>");
    expect(prompt).not.toContain("mcp-instructions");
  });

  it("lists only the dedicated tools that are registered", () => {
    const prompt = buildUsingToolsPrompt([
      tool(BASH_TOOL_NAME),
      tool(READ_TOOL_NAME),
    ]);

    expect(prompt).toContain(
      `Prefer dedicated tools over ${BASH_TOOL_NAME} when one fits (${READ_TOOL_NAME})`,
    );
  });

  it("omits the shell entry when Bash is absent", () => {
    const prompt = buildUsingToolsPrompt([tool(READ_TOOL_NAME)]);

    expect(prompt).toContain(TOOLS_HEADER);
    expect(prompt).not.toContain(BASH_TOOL_NAME);
  });

  it("includes the task entry only when the task tool is available", () => {
    expect(buildUsingToolsPrompt([tool(BASH_TOOL_NAME)])).not.toContain(
      TASK_CREATE_TOOL_NAME,
    );
    expect(
      buildUsingToolsPrompt([
        tool(BASH_TOOL_NAME),
        tool(TASK_CREATE_TOOL_NAME),
      ]),
    ).toContain(TASK_CREATE_TOOL_NAME);
  });

  it("opens both tiers with the identity line and the safety note", () => {
    const lean = flattenBlocks(
      buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], { leanPrompt: true }),
    );
    const full = flattenBlocks(
      buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], { leanPrompt: false }),
    );

    for (const prompt of [lean, full]) {
      expect(prompt).toContain(DEFAULT_SYSTEM_PROMPT);
      expect(prompt).toContain(SECURITY_NOTE);
    }
    // The URL guard is full-tier only, matching Claude Code's `Coo()`.
    expect(full).toContain(URL_GUARD);
    expect(lean).not.toContain(URL_GUARD);
  });

  it("replaces every full-tier section with the lean block when leanPrompt is on", () => {
    const tools = [tool(READ_TOOL_NAME)];
    const prompt = flattenBlocks(
      buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, tools, { leanPrompt: true }),
    );

    expect(prompt).toContain(LEAN_SYSTEM_PROMPT);
    // The safety note reaches the lean tier through the identity section, so
    // the harness block must not repeat it.
    expect(LEAN_SYSTEM_PROMPT).not.toContain(SECURITY_NOTE);
    expect(prompt).not.toContain(SYSTEM_PROMPT);
    expect(prompt).not.toContain(DOING_TASKS_PROMPT);
    expect(prompt).not.toContain(TOOLS_HEADER);
    expect(prompt).not.toContain(TONE_AND_STYLE_PROMPT);
  });

  it("keeps the full static sections when leanPrompt is off", () => {
    const prompt = flattenBlocks(
      buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], { leanPrompt: false }),
    );

    expect(prompt).toContain(SECURITY_NOTE);
    expect(prompt).toContain(SYSTEM_PROMPT);
    expect(prompt).toContain(DOING_TASKS_PROMPT);
    expect(prompt).toContain(TONE_AND_STYLE_PROMPT);
    expect(prompt).not.toContain("# Output efficiency");
    expect(prompt).not.toContain(LEAN_SYSTEM_PROMPT);
  });
});
