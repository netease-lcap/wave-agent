/**
 * Collapse every run of whitespace (newlines included) into a single space.
 *
 * Terminal pickers render one row per entry, so text that arrives with hard
 * line breaks must be flattened *before* it is truncated — a skill description
 * carrying a `TRIGGER when:` block would otherwise turn one row into six and
 * make the whole menu grow, shrink and jitter as the selection moves.
 */
export const toOneLine = (text: string): string =>
  text.replace(/\s+/g, " ").trim();
