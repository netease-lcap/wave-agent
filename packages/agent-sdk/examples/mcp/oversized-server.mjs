/**
 * An MCP server whose `instructions` deliberately exceed the 2048-character cap,
 * plus a tool so a turn has something to call.
 *
 * The last line before the cap is a canary: it must not survive into the
 * conversation, and the truncated copy must say so with `… [truncated]`.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const SERVER_NAME = "oversized-demo";

/** Long enough that the tail is cut; `LAST LINE` sits at the very end. */
const INSTRUCTIONS = [
  "Usage notes for this server:",
  ...Array.from(
    { length: 55 },
    (_, i) =>
      `- Note ${i + 1}: prefer one batched call over many small ones here.`,
  ),
  "LAST LINE: past the cap, so it must never reach the model.",
].join("\n");

const WORD_COUNT_TOOL = {
  name: "word_count",
  description: "Count the words in a piece of text.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text to count." },
    },
    required: ["text"],
  },
};

const server = new Server(
  { name: SERVER_NAME, version: "1.0.0" },
  { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [WORD_COUNT_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const text = String(request.params.arguments?.text ?? "");
  const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
  return {
    content: [{ type: "text", text: JSON.stringify({ words }) }],
  };
});

await server.connect(new StdioServerTransport());
