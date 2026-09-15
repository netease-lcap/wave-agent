/**
 * An MCP server whose tools exercise every branch of the `Exec` catalog renderer:
 * a deeply nested schema (depth guard), a wide enum, a long tool description (the
 * one thing that gets clamped), a multi-line field description (kept verbatim),
 * and a wide `anyOf` union.
 *
 * Also carries the simple tools the other examples call.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const SERVER_NAME = "catalog-demo";

/** `levels` nested objects, deepest wrapping a plain string. */
function nestedSchema(levels) {
  let schema = { type: "string", description: "The innermost value." };
  for (let i = levels; i > 0; i -= 1) {
    schema = {
      type: "object",
      description: `Container at depth ${i}.`,
      properties: { [`level${i}`]: schema },
    };
  }
  return schema;
}

const TOOLS = [
  {
    name: "deep_lookup",
    description: "Look up a value through a deeply nested path.",
    inputSchema: nestedSchema(10),
  },
  {
    name: "set_channel",
    description: "Move the session to another release channel.",
    inputSchema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description:
            "Which channel to move to. Pick `stable` unless you were asked\nfor a pre-release build.",
          enum: [
            "stable",
            "beta",
            "nightly",
            "canary",
            "edge",
            "legacy",
            "lts",
            "preview",
            "internal",
            "experimental",
            "deprecated",
            "sunset",
          ],
        },
      },
      required: ["channel"],
    },
  },
  {
    name: "describe_registry",
    description:
      "Registers a component in the catalog so that later tool calls can refer to it by short name; the registry is per-session and is cleared when the connection drops.\nThis second line is padding and must not survive the clamp.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short name to register." },
      },
      required: ["name"],
    },
  },
  {
    name: "pick_engine",
    description: "Pick the engine used for a run.",
    inputSchema: {
      type: "object",
      properties: {
        engine: {
          anyOf: [
            { type: "object", properties: { kind: { enum: ["a"] } } },
            { type: "object", properties: { kind: { enum: ["b"] } } },
            { type: "object", properties: { kind: { enum: ["c"] } } },
            { type: "object", properties: { kind: { enum: ["d"] } } },
            { type: "object", properties: { kind: { enum: ["e"] } } },
            { type: "object", properties: { kind: { enum: ["f"] } } },
          ],
        },
      },
      required: ["engine"],
    },
  },
  {
    name: "reverse_text",
    description: "Reverse the characters of a piece of text.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text to reverse, verbatim.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "word_count",
    description: "Count the words in a piece of text.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to count." },
      },
      required: ["text"],
    },
  },
  {
    name: "sum_numbers",
    description: "Add a list of numbers.",
    inputSchema: {
      type: "object",
      properties: {
        numbers: {
          type: "array",
          items: { type: "number" },
          description: "The numbers to add.",
        },
      },
      required: ["numbers"],
    },
  },
  {
    name: "shout",
    description: "Uppercase a piece of text.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to uppercase." },
      },
      required: ["text"],
    },
  },
];

const server = new Server(
  { name: SERVER_NAME, version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments ?? {};
  const text = String(args.text ?? "");
  const result = {};
  switch (request.params.name) {
    case "reverse_text":
      result.reversed = [...text].reverse().join("");
      break;
    case "word_count":
      result.words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
      break;
    case "sum_numbers": {
      const numbers = Array.isArray(args.numbers) ? args.numbers : [];
      result.sum = numbers.reduce(
        (total, value) => total + Number(value ?? 0),
        0,
      );
      break;
    }
    case "shout":
      result.shouted = text.toUpperCase();
      break;
    default:
      result.acknowledged = request.params.name;
  }
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

await server.connect(new StdioServerTransport());
