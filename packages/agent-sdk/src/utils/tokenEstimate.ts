/**
 * CJK-aware token estimation without external dependencies.
 *
 * The naive `length / 4` heuristic under-estimates CJK text by ~4x because
 * each Chinese/Japanese/Korean character is typically 1-2 tokens, not 0.25.
 * This function separates CJK characters from other text and applies
 * different ratios:
 *
 * - CJK characters: 1 char ≈ 1 token
 * - Other characters: 4 chars ≈ 1 token (2 for JSON/JSONL/JSONC)
 *
 * The estimate intentionally leans high for CJK (safe direction for limit
 * checks — better to reject than to let oversized content through).
 */

// CJK Unified Ideographs + Extension A + Hiragana + Katakana + Hangul Syllables
const CJK_REGEX =
  /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;

/**
 * Estimate token count for a string, with CJK-awareness.
 *
 * @param content - The text content to estimate
 * @param ext - File extension (without dot), e.g. "ts", "json". JSON/JSONL/JSONC
 *              files use a tighter ratio (2 chars/token) for non-CJK text.
 * @returns Estimated token count
 */
export function estimateTokens(content: string, ext?: string): number {
  const cjkCount = (content.match(CJK_REGEX) || []).length;
  const otherCount = content.length - cjkCount;
  const bytesPerToken =
    ext === "json" || ext === "jsonl" || ext === "jsonc" ? 2 : 4;
  return Math.ceil(cjkCount + otherCount / bytesPerToken);
}
