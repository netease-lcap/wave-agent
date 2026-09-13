import { describe, it, expect } from "vitest";
import {
  TOOL_SEARCH_TOOL_NAME,
  TOOL_INVOKE_TOOL_NAME,
  buildToolInvokeConfig,
  formatForwardedToolAddress,
} from "@/tools/deferredTools.js";

describe("formatForwardedToolAddress", () => {
  it("addresses a forwarded MCP leaf as <namespace>.<tool>", () => {
    expect(
      formatForwardedToolAddress(TOOL_INVOKE_TOOL_NAME, {
        namespace: "github",
        tool: "create_issue",
        args: { title: "x" },
      }),
    ).toBe("github.create_issue");
  });

  it("addresses a forwarded built-in leaf under the reserved namespace", () => {
    expect(
      formatForwardedToolAddress(TOOL_INVOKE_TOOL_NAME, {
        namespace: "builtin",
        tool: "WebFetch",
        args: {},
      }),
    ).toBe("builtin.WebFetch");
  });

  it("keeps a leaf name that itself contains the separator intact", () => {
    expect(
      formatForwardedToolAddress(TOOL_INVOKE_TOOL_NAME, {
        namespace: "github",
        tool: "create__issue",
      }),
    ).toBe("github.create__issue");
  });

  it("ignores surrounding whitespace", () => {
    expect(
      formatForwardedToolAddress(TOOL_INVOKE_TOOL_NAME, {
        namespace: " github ",
        tool: " create_issue ",
      }),
    ).toBe("github.create_issue");
  });

  it("falls back to the real tool name when the call is not addressable", () => {
    for (const args of [
      undefined,
      null,
      "github.create_issue",
      {},
      { namespace: "github" },
      { tool: "create_issue" },
      { namespace: "", tool: "create_issue" },
      { namespace: "github", tool: "   " },
      { namespace: 7, tool: "create_issue" },
      { namespace: "github", tool: { name: "create_issue" } },
    ]) {
      expect(formatForwardedToolAddress(TOOL_INVOKE_TOOL_NAME, args)).toBe(
        undefined,
      );
    }
  });

  it("does not touch any other tool", () => {
    expect(
      formatForwardedToolAddress("Bash", { command: "ls" }),
    ).toBeUndefined();
    expect(
      formatForwardedToolAddress(TOOL_SEARCH_TOOL_NAME, {
        namespace: "github",
        tool: "create_issue",
      }),
    ).toBeUndefined();
  });
});

describe("mechanism tool declarations", () => {
  it("keeps the catalog text as the whole description of ToolInvoke", () => {
    const config = buildToolInvokeConfig("CATALOG TEXT");
    expect(config.function.name).toBe(TOOL_INVOKE_TOOL_NAME);
    expect(config.function.description).toBe("CATALOG TEXT");
    expect(config.function.parameters).toMatchObject({
      required: ["namespace", "tool"],
      properties: {
        namespace: { type: "string" },
        tool: { type: "string" },
        args: { type: "object", additionalProperties: true },
      },
    });
  });
});
