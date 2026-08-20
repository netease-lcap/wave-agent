/**
 * Single-line tail representation of in-flight streaming text: newlines are
 * flattened to `\n` and, when longer than `maxLen` characters, only the last
 * `maxLen` characters are kept behind an ellipsis. Mirrors the CLI's
 * `streamingTail` (packages/code/src/utils/streamingText.ts) so the loading
 * indicators (compaction / /btw) keep the same tail style across surfaces.
 */
export const streamingTail = (content: string, maxLen = 30): string => {
  const flat = content.replace(/\n/g, "\\n");
  return flat.length > maxLen ? `…${flat.slice(-maxLen)}` : flat;
};
