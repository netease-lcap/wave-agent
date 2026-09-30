/**
 * An MCP server with enough documented tools to make the `Exec` pool large.
 *
 * Every tool carries three documented fields, so one `search` hit is a long
 * signature block — the reason the announcement lists names only and leaves the
 * schemas to be pulled one at a time.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const SERVER_NAME = "bulk-demo";
const TOOL_COUNT = 24;

const TOOLS = Array.from({ length: TOOL_COUNT }, (_, index) => ({
  name: `bulk_step_${index}`,
  description: `Run bulk step ${index} of the pipeline and report what it produced.`,
  inputSchema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description:
          "The resource this step operates on, by name or path, exactly as the previous step reported it.",
      },
      mode: {
        type: "string",
        description:
          "How to run the step: `dry` reports what would change, `apply` performs the change, `force` reruns it anyway.",
      },
      note: {
        type: "string",
        description:
          "Optional free-form note stored with the run result, so a later step can explain why the pipeline moved.",
      },
    },
    required: ["target"],
  },
}));

const server = new Server(
  { name: SERVER_NAME, version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        step: request.params.name,
        target: String(request.params.arguments?.target ?? ""),
      }),
    },
  ],
}));

await server.connect(new StdioServerTransport());
