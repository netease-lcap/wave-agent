/**
 * Tool parameter to diff change transformation utilities
 * Converts tool execution parameters into standardized Change[] arrays for UI rendering
 */

import type { Change } from "../types/core.js";
import type { ToolBlock } from "../types/messaging.js";

/**
 * Transform tool block parameters into standardized Change[] array for diff display
 *
 * @param toolBlock - Tool execution block with parameters
 * @returns Array of Change objects representing diff content
 */
export function transformToolBlockToChanges(toolBlock: ToolBlock): Change[] {
  try {
    if (!toolBlock.name || !toolBlock.parameters) {
      return [];
    }

    const toolName = toolBlock.name;

    // Parse parameters from string format
    let parsedParams: Record<string, unknown>;
    try {
      // Try to extract JSON from parameters string
      // Parameters might be formatted as "key=value, key=value" or JSON
      if (toolBlock.parameters.trim().startsWith("{")) {
        parsedParams = JSON.parse(toolBlock.parameters);
      } else {
        // Handle parameter string parsing for non-JSON format
        parsedParams = parseParameterString(toolBlock.parameters);
      }
    } catch (error) {
      console.warn("Failed to parse tool parameters:", error);
      return [];
    }

    // Extract file path for context (will be used by UI layer)
    // Note: File path extraction is handled in the UI layer for this implementation

    switch (toolName) {
      case "Write":
        return transformWriteToolChanges(parsedParams);

      case "Edit":
        return transformEditToolChanges(parsedParams);

      case "MultiEdit":
        return transformMultiEditToolChanges(parsedParams);

      default:
        return []; // Unsupported tool types return empty array
    }
  } catch (error) {
    console.warn("Failed to transform tool result to changes:", error);
    return []; // Always return valid Change[] array
  }
}

/**
 * Parse parameter string into object (for non-JSON formatted parameters)
 * Handles multiple parameter formats including key=value pairs and structured data
 */
function parseParameterString(paramString: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  // Handle JSON-like objects that may not be valid JSON
  if (paramString.includes("{") && paramString.includes("}")) {
    try {
      // Try to fix common JSON issues and parse
      const fixedJson = paramString
        .replace(/'/g, '"') // Replace single quotes with double quotes
        .replace(/(\w+):/g, '"$1":') // Quote unquoted keys
        .replace(/,\s*}/g, "}") // Remove trailing commas
        .replace(/,\s*]/g, "]"); // Remove trailing commas in arrays

      return JSON.parse(fixedJson);
    } catch {
      console.warn(
        "Failed to parse JSON-like parameters, falling back to key=value parsing",
      );
    }
  }

  // Try to match various parameter patterns
  const patterns = [
    // Pattern: key=value, key2=value2
    /(\w+)\s*=\s*([^,]+?)(?:\s*,\s*(?=\w+\s*=)|$)/g,
    // Pattern: key: value, key2: value2
    /(\w+)\s*:\s*([^,]+?)(?:\s*,\s*(?=\w+\s*:)|$)/g,
    // Pattern: --key value --key2 value2
    /--(\w+)\s+([^\s-]+)/g,
  ];

  for (const regex of patterns) {
    let match;
    regex.lastIndex = 0; // Reset regex state

    while ((match = regex.exec(paramString)) !== null) {
      const key = match[1].trim();
      let value = match[2].trim();

      // Remove quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      // Try to parse as JSON if it looks like an object or array
      if (
        (value.startsWith("{") && value.endsWith("}")) ||
        (value.startsWith("[") && value.endsWith("]"))
      ) {
        try {
          params[key] = JSON.parse(value);
        } catch {
          params[key] = value;
        }
      } else {
        params[key] = value;
      }
    }

    // If we found parameters with this pattern, stop trying other patterns
    if (Object.keys(params).length > 0) {
      break;
    }
  }

  // If no structured parameters found, try to extract file paths and content
  if (Object.keys(params).length === 0) {
    // Look for common file path patterns
    const filePathMatch = paramString.match(
      /(?:file_path|target_file|path):\s*([^\s,]+)/i,
    );
    if (filePathMatch) {
      params.file_path = filePathMatch[1];
    }

    // Look for content in the remaining string
    const contentMatch = paramString.match(
      /content:\s*(.+?)(?:\s*,\s*\w+:|$)/is,
    );
    if (contentMatch) {
      params.content = contentMatch[1].trim();
    }
  }

  return params;
}

/**
 * Transform Write tool parameters to changes (empty oldContent, content as newContent)
 */
function transformWriteToolChanges(
  parameters: Record<string, unknown>,
): Change[] {
  if (!parameters.content || typeof parameters.content !== "string") {
    return [];
  }

  return [
    {
      oldContent: "", // No previous content for write operations
      newContent: parameters.content,
    },
  ];
}

/**
 * Transform Edit tool parameters to changes (old_string to new_string)
 */
function transformEditToolChanges(
  parameters: Record<string, unknown>,
): Change[] {
  const { old_string, new_string } = parameters;

  if (typeof old_string !== "string" || typeof new_string !== "string") {
    return [];
  }

  return [
    {
      oldContent: old_string,
      newContent: new_string,
    },
  ];
}

/**
 * Transform MultiEdit tool parameters to changes (multiple old_string/new_string pairs)
 */
function transformMultiEditToolChanges(
  parameters: Record<string, unknown>,
): Change[] {
  const { edits } = parameters;

  if (!Array.isArray(edits)) {
    return [];
  }

  // Process each edit in the array
  return edits
    .filter(
      (edit: unknown) =>
        edit &&
        typeof edit === "object" &&
        "old_string" in edit &&
        "new_string" in edit &&
        typeof (edit as { old_string: unknown }).old_string === "string" &&
        typeof (edit as { new_string: unknown }).new_string === "string",
    )
    .map((edit) => ({
      oldContent: (edit as { old_string: string }).old_string,
      newContent: (edit as { new_string: string }).new_string,
    }));
}
