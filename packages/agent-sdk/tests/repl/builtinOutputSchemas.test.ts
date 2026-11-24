import { describe, expect, it } from "vitest";
import { renderToolSignature } from "../../src/repl/catalog.js";
import type { ToolPlugin } from "../../src/tools/types.js";
import { artifactCommentsTool } from "../../src/tools/artifactCommentsTool.js";
import { bashTool } from "../../src/tools/bashTool.js";
import { cronCreateTool } from "../../src/tools/cronCreateTool.js";
import { cronDeleteTool } from "../../src/tools/cronDeleteTool.js";
import { cronListTool } from "../../src/tools/cronListTool.js";
import { editTool } from "../../src/tools/editTool.js";
import { enterPlanModeTool } from "../../src/tools/enterPlanMode.js";
import { enterWorktreeTool } from "../../src/tools/enterWorktreeTool.js";
import { exitPlanModeTool } from "../../src/tools/exitPlanMode.js";
import { exitWorktreeTool } from "../../src/tools/exitWorktreeTool.js";
import { globTool } from "../../src/tools/globTool.js";
import { grepTool } from "../../src/tools/grepTool.js";
import { lspTool } from "../../src/tools/lspTool.js";
import { powershellTool } from "../../src/tools/powershellTool/powershellTool.js";
import { readTool } from "../../src/tools/readTool.js";
import {
  taskCreateTool,
  taskGetTool,
  taskListTool,
  taskUpdateTool,
} from "../../src/tools/taskManagementTools.js";
import { taskStopTool } from "../../src/tools/taskStopTool.js";
import { webFetchTool } from "../../src/tools/webFetchTool.js";
import { webSearchTool } from "../../src/tools/webSearchTool.js";
import { writeTool } from "../../src/tools/writeTool.js";

/**
 * Every built-in a script can reach declares the shape of its `data`.
 *
 * The signature the sandbox shows says `Promise<...>` from this schema (spec
 * core/repl-tool.md「公告分档呈现」). A tool that forgets it degrades to
 * `Promise<unknown>`, which is exactly the guess a search round-trip then has to
 * correct — so the list is asserted rather than trusted.
 */
const BUILT_INS: ToolPlugin[] = [
  readTool,
  globTool,
  grepTool,
  bashTool,
  powershellTool,
  writeTool,
  editTool,
  artifactCommentsTool,
  cronCreateTool,
  cronDeleteTool,
  cronListTool,
  enterPlanModeTool,
  exitPlanModeTool,
  enterWorktreeTool,
  exitWorktreeTool,
  lspTool,
  taskCreateTool,
  taskGetTool,
  taskListTool,
  taskUpdateTool,
  taskStopTool,
  webFetchTool,
  webSearchTool,
];

describe("built-in output schemas", () => {
  it("covers the twenty-three tools a script can reach", () => {
    expect(BUILT_INS).toHaveLength(23);
  });

  for (const tool of BUILT_INS) {
    it(`${tool.name} declares the shape of its data`, () => {
      expect(tool.outputSchema).toBeTypeOf("object");
      const signature = renderToolSignature({
        name: tool.name,
        inputSchema: tool.config.function.parameters as
          | Record<string, unknown>
          | undefined,
        outputSchema: tool.outputSchema,
      });
      // The rendered return type is the point: `string` would invite a `.split()` on
      // an object, and `unknown` means the declaration above is not being used.
      expect(signature).not.toContain("Promise<string>");
      expect(signature).not.toContain("Promise<unknown>");
      expect(signature).toContain("Promise<");
    });
  }
});
