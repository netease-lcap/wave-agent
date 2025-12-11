import { writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { logger } from "./globalLogger.js";
import {
  estimateTokenCount,
  getTokenUsageDescription,
} from "./tokenEstimator.js";

// Token threshold for writing output to temp file (20k tokens)
export const LARGE_OUTPUT_TOKEN_THRESHOLD = 20000;

/**
 * Handle large command output by writing to temporary file when token threshold is exceeded
 *
 * Uses token-based threshold (20k tokens) to determine when output should be written to temp file.
 * This provides accurate estimation of actual token cost for LLM processing.
 *
 * @param output - The command output string
 * @returns Object containing processed content and optional file path
 */
export async function handleLargeOutput(output: string): Promise<{
  content: string;
  filePath?: string;
}> {
  const estimatedTokens = estimateTokenCount(output);

  // Check token threshold
  if (estimatedTokens <= LARGE_OUTPUT_TOKEN_THRESHOLD) {
    return { content: output };
  }

  try {
    // Create temp file for large output
    const tempFileName = `bash-output-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.txt`;
    const tempFilePath = join(tmpdir(), tempFileName);

    await writeFile(tempFilePath, output, "utf8");

    const sizeKB = Math.round(output.length / 1024);
    const tokenDescription = getTokenUsageDescription(
      output,
      LARGE_OUTPUT_TOKEN_THRESHOLD,
    );

    return {
      content: `Large output (${sizeKB} KB, ${tokenDescription}) written to temporary file. Use the Read tool to access the full content.`,
      filePath: tempFilePath,
    };
  } catch (error) {
    logger.warn(`Failed to write large output to temp file: ${error}`);
    // Fallback to direct output if temp file creation fails
    return { content: output };
  }
}
