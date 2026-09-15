#!/usr/bin/env node
/**
 * A minimal stdio MCP server for `instructions-example.ts`.
 *
 * It keeps the example runnable with no API key, no network and no extra
 * dependency: only the MCP SDK that `wave-agent-sdk` already depends on. The two
 * things it exists to demonstrate are that it declares multi-line `instructions`
 * (the server-level notes specified in `docs/specs/ecosystem/mcp.md`), and that
 * it exposes one deterministic tool.
 *
 * stdout carries the JSON-RPC protocol, so every trace goes to stderr.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const SERVER_NAME = "instructions-demo";

/**
 * Server-level notes: the "you need to know this without calling anything"
 * content that cannot ride in a tool description.
 */
const INSTRUCTIONS = [
  "Usage notes for this server:",
  "- Every tool here is read-only; nothing is written to disk.",
  "- Rate limit: at most 60 calls per minute per session.",
  "- Prefer one batched call over many small ones.",
  '- If a call returns "isError": true, report the message verbatim instead of retrying.',
].join("\n");

const REVERSE_TOOL = {
  name: "reverse_text",
  description:
    "Reverse a string of text character by character. Always use this tool when the user asks for reversed text; never reverse by hand.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text to reverse." },
    },
    required: ["text"],
  },
};

const server = new Server(
  { name: SERVER_NAME, version: "1.0.0" },
  { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [REVERSE_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  process.stderr.write(`[${SERVER_NAME}] tool call: ${name}\n`);

  if (name !== REVERSE_TOOL.name) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  const text = typeof args?.text === "string" ? args.text : "";
  return {
    content: [{ type: "text", text: [...text].reverse().join("") }],
  };
});

await server.connect(new StdioServerTransport());
