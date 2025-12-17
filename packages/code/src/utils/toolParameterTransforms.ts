/**
 * Tool parameter transformation utilities for UI rendering
 * Forces type judgment based on tool name using type assertions
 */

import {
  type Change,
  type WriteToolParameters,
  type EditToolParameters,
  type MultiEditToolParameters,
} from "wave-agent-sdk";
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
 * Transform Write tool parameters to changes
 */
export function transformWriteParameters(
  parameters: WriteToolParameters,
): Change[] {
  return [
    {
      oldContent: "", // No previous content for write operations
      newContent: parameters.content,
    },
  ];
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
 * Transform MultiEdit tool parameters to changes
 */
export function transformMultiEditParameters(
  parameters: MultiEditToolParameters,
): Change[] {
  return parameters.edits.map((edit) => ({
    oldContent: edit.old_string,
    newContent: edit.new_string,
  }));
}

/**
 * Transform tool block parameters into standardized Change[] array for diff display
 * Forces type judgment based on tool name using type assertions
 */
export function transformToolBlockToChanges(
  toolName: string,
  parameters: string,
): Change[] {
  try {
    if (!toolName) {
      return [];
    }

    const parsedParams = parseToolParameters(parameters);

    switch (toolName) {
      case "Write":
        return transformWriteParameters(parsedParams as WriteToolParameters);

      case "Edit":
        return transformEditParameters(parsedParams as EditToolParameters);

      case "MultiEdit":
        return transformMultiEditParameters(
          parsedParams as MultiEditToolParameters,
        );

      default:
        return [];
    }
  } catch (error) {
    logger.warn("Failed to transform tool block to changes:", error);
    return [];
  }
}
