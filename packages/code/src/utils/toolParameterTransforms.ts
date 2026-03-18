/**
 * Tool parameter transformation utilities for UI rendering
 * Forces type judgment based on tool name using type assertions
 */

import { type Change, type EditToolParameters } from "wave-agent-sdk";
import { logger } from "./logger.js";

/**
 * Parse tool block parameters
 */
function parseToolParameters(parameters: string): unknown {
  if (!parameters) {
    return {};
  }

  try {
    return JSON.parse(parameters);
  } catch (error) {
    logger.warn("Failed to parse tool parameters:", error);
    return {};
  }
}

/**
 * Transform Edit tool parameters to changes
 */
export function transformEditParameters(
  parameters: EditToolParameters,
): Change[] {
  return [
    {
      oldContent: parameters.old_string,
      newContent: parameters.new_string,
    },
  ];
}

/**
 * Transform tool block parameters into standardized Change[] array for diff display
 * Forces type judgment based on tool name using type assertions
 */
export function transformToolBlockToChanges(
  toolName: string,
  parameters: string,
  startLineNumber?: number,
): Change[] {
  try {
    if (!toolName) {
      return [];
    }

    const parsedParams = parseToolParameters(parameters);

    let changes: Change[] = [];
    switch (toolName) {
      case "Edit":
        changes = transformEditParameters(parsedParams as EditToolParameters);
        break;

      default:
        return [];
    }

    if (changes.length > 0 && startLineNumber !== undefined) {
      changes[0].startLineNumber = startLineNumber;
    }
    return changes;
  } catch (error) {
    logger.warn("Failed to transform tool block to changes:", error);
    return [];
  }
}
