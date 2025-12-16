/**
 * Tool parameter transformation utilities for UI rendering
 * Forces type judgment based on tool name using type assertions
 */

import {
  type Change,
  type ToolBlock,
  type WriteToolParameters,
  type EditToolParameters,
  type MultiEditToolParameters,
} from "wave-agent-sdk";
import { logger } from "./logger.js";

/**
 * Parse tool block parameters
 */
function parseToolParameters(toolBlock: ToolBlock): unknown {
  if (!toolBlock.parameters) {
    return {};
  }

  try {
    return JSON.parse(toolBlock.parameters);
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
export function transformToolBlockToChanges(toolBlock: ToolBlock): Change[] {
  try {
    if (!toolBlock.name) {
      return [];
    }

    const parsedParams = parseToolParameters(toolBlock);

    switch (toolBlock.name) {
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

/**
 * Extract file path from parsed tool parameters based on tool name
 */
export function extractFilePathFromToolBlock(
  toolBlock: ToolBlock,
): string | null {
  const parsedParams = parseToolParameters(toolBlock);

  switch (toolBlock.name) {
    case "Write":
      return (parsedParams as WriteToolParameters).file_path || null;
    case "Edit":
      return (parsedParams as EditToolParameters).file_path || null;
    case "MultiEdit":
      return (parsedParams as MultiEditToolParameters).file_path || null;
    default:
      return null;
  }
}
