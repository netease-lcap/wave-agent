import type { ToolPlugin, ToolResult } from "../tools/types.js";

const STRUCTURED_OUTPUT_TOOL_NAME = "StructuredOutput";

/**
 * Creates a system prompt addition that instructs the agent to use structured output
 */
export function createStructuredOutputPrompt(schema: object): string {
  return `\n\nIMPORTANT: You MUST call the ${STRUCTURED_OUTPUT_TOOL_NAME} tool with your final answer. Do not just write the answer as text — call the tool with a JSON object matching this schema:\n${JSON.stringify(schema, null, 2)}\n\nCall this tool exactly once with your complete answer.`;
}

/**
 * Creates a StructuredOutput ToolPlugin that enforces the given schema
 */
export function createStructuredOutputTool(schema: object): ToolPlugin {
  return {
    name: STRUCTURED_OUTPUT_TOOL_NAME,
    config: {
      type: "function" as const,
      function: {
        name: STRUCTURED_OUTPUT_TOOL_NAME,
        description:
          "Output structured data matching the required schema. Call this with your final answer.",
        parameters: schema as Record<string, unknown>,
      },
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
      // The tool just returns the args as-is — the real validation happens
      // in extractStructuredResult after the agent completes
      return {
        success: true,
        content: JSON.stringify(args),
      };
    },
  };
}

/**
 * Extract structured result from a completed subagent's messages.
 * Looks for StructuredOutput tool calls in the messages.
 * Falls back to JSON.parse on the last assistant message text.
 */
export function extractStructuredResult(
  messages: Array<{
    role: string;
    content?: string;
    tool_calls?: Array<{ function: { name: string; arguments: string } }>;
  }>,
  schema: object,
): unknown | null {
  // Search messages in reverse for a StructuredOutput tool call
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.function.name === STRUCTURED_OUTPUT_TOOL_NAME) {
          try {
            const parsed = JSON.parse(tc.function.arguments);
            if (validateAgainstSchema(parsed, schema)) {
              return parsed;
            }
          } catch {
            // Parse error — continue searching
          }
        }
      }
    }
  }

  // Fallback: try to extract JSON from the last assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && msg.content) {
      // Try to find JSON in the content
      const jsonMatch = msg.content.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (validateAgainstSchema(parsed, schema)) {
            return parsed;
          }
        } catch {
          // Parse error — continue
        }
      }

      // Try parsing the entire content as JSON
      try {
        const parsed = JSON.parse(msg.content);
        if (validateAgainstSchema(parsed, schema)) {
          return parsed;
        }
      } catch {
        // Not JSON — continue
      }
    }
  }

  return null;
}

/**
 * Basic schema validation — checks that required fields exist.
 * This is intentionally lightweight; full JSON Schema validation
 * would require a dependency like ajv.
 */
function validateAgainstSchema(data: unknown, schema: object): boolean {
  if (!data || typeof data !== "object") return false;
  const schemaObj = schema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  if (schemaObj.required && Array.isArray(schemaObj.required)) {
    for (const field of schemaObj.required) {
      if (!(field in (data as Record<string, unknown>))) {
        return false;
      }
    }
  }
  return true;
}

export { STRUCTURED_OUTPUT_TOOL_NAME };
