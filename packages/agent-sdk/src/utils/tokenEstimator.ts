/**
 * Simple token estimation utility for text content
 *
 * This provides a fast approximation of token count without requiring
 * actual tokenization, which would be expensive for large content.
 */

/**
 * Estimate the number of tokens in a text string
 *
 * Uses a simple heuristic based on character count and common patterns:
 * - Average token length varies by language and content type
 * - English text: ~4-5 characters per token
 * - Code/structured text: ~3-4 characters per token
 * - Numbers/symbols: ~2-3 characters per token
 *
 * This function uses a conservative estimate of 4 characters per token
 * which works well for mixed content (text + code + symbols).
 *
 * @param text - The text to estimate tokens for
 * @returns Estimated number of tokens
 */
export function estimateTokenCount(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }

  // Base estimation: 4 characters per token (conservative)
  const baseEstimate = Math.ceil(text.length / 4);

  // Adjust for whitespace (spaces don't contribute much to token count)
  const whitespaceCount = (text.match(/\s/g) || []).length;
  const adjustedEstimate = Math.ceil((text.length - whitespaceCount * 0.5) / 4);

  // Use the more conservative (higher) estimate
  return Math.max(baseEstimate, adjustedEstimate);
}

/**
 * Check if estimated token count exceeds a threshold
 *
 * @param text - The text to check
 * @param threshold - Token threshold (default: 20,000)
 * @returns True if estimated tokens exceed threshold
 */
export function exceedsTokenThreshold(
  text: string,
  threshold: number = 20000,
): boolean {
  return estimateTokenCount(text) > threshold;
}

/**
 * Get a human-readable description of estimated token usage
 *
 * @param text - The text to analyze
 * @param threshold - Token threshold for comparison
 * @returns Description string with token count and threshold info
 */
export function getTokenUsageDescription(
  text: string,
  threshold: number = 20000,
): string {
  const estimatedTokens = estimateTokenCount(text);
  const exceedsThreshold = estimatedTokens > threshold;

  return `${estimatedTokens.toLocaleString()} tokens (${exceedsThreshold ? "exceeds" : "within"} ${threshold.toLocaleString()} limit)`;
}
