import { describe, it, expect } from "vitest";
import { truncateEntrypointContent } from "../../src/utils/memoryEntrypoint.js";
import {
  MAX_MEMORY_ENTRYPOINT_CHARS,
  MAX_MEMORY_ENTRYPOINT_LINES,
  MEMORY_INDEX_LINE_GUIDANCE_CHARS,
} from "../../src/constants/memory.js";

describe("truncateEntrypointContent", () => {
  it("returns content unchanged when under both caps", () => {
    const raw = "# Project Memory\n\n- [a](a.md) — one line\n";
    const result = truncateEntrypointContent(raw);

    expect(result.content).toBe("# Project Memory\n\n- [a](a.md) — one line");
    expect(result.wasLineTruncated).toBe(false);
    expect(result.wasCharTruncated).toBe(false);
    expect(result.content).not.toContain("WARNING");
  });

  it("truncates at the line cap and names the line count", () => {
    const lines = Array.from(
      { length: MAX_MEMORY_ENTRYPOINT_LINES + 50 },
      (_, i) => `Line ${i + 1}`,
    );
    const result = truncateEntrypointContent(lines.join("\n"));

    expect(result.wasLineTruncated).toBe(true);
    expect(result.wasCharTruncated).toBe(false);
    expect(result.loadedLineCount).toBe(MAX_MEMORY_ENTRYPOINT_LINES);

    const body = result.content.split("\n\n> WARNING:")[0];
    expect(body).toContain(`Line ${MAX_MEMORY_ENTRYPOINT_LINES}`);
    expect(body).not.toContain(`Line ${MAX_MEMORY_ENTRYPOINT_LINES + 1}`);
    expect(result.content).toContain(
      `WARNING: MEMORY.md is ${lines.length} lines (limit: ${MAX_MEMORY_ENTRYPOINT_LINES})`,
    );
    expect(result.content).toContain("move detail into topic files");
  });

  it("names how many lines were dropped, where, and echoes the first one", () => {
    const lines = Array.from(
      { length: MAX_MEMORY_ENTRYPOINT_LINES + 50 },
      (_, i) => `Line ${i + 1}`,
    );
    const result = truncateEntrypointContent(lines.join("\n"));

    expect(result.content).toContain(
      `50 of ${lines.length} lines were cut off, starting at line ${MAX_MEMORY_ENTRYPOINT_LINES + 1}`,
    );
    expect(result.content).toContain(
      `("Line ${MAX_MEMORY_ENTRYPOINT_LINES + 1}")`,
    );
  });

  it("reports the wrong advice nowhere: the per-line guidance is the constants'", () => {
    const lines = Array.from(
      { length: MAX_MEMORY_ENTRYPOINT_LINES + 1 },
      (_, i) => `Line ${i + 1}`,
    );
    const result = truncateEntrypointContent(lines.join("\n"));

    expect(result.content).toContain(
      `under ~${MEMORY_INDEX_LINE_GUIDANCE_CHARS} chars`,
    );
  });

  it("truncates at the character cap when a single line is too long", () => {
    const result = truncateEntrypointContent("x".repeat(30_000));

    expect(result.wasLineTruncated).toBe(false);
    expect(result.wasCharTruncated).toBe(true);
    expect(result.loadedLineCount).toBe(1);
    expect(result.content).toContain(
      `WARNING: MEMORY.md is 30000 characters (limit: ${MAX_MEMORY_ENTRYPOINT_CHARS}) — index entries are too long`,
    );
    expect(result.content).toContain(
      `everything after the first ${MAX_MEMORY_ENTRYPOINT_CHARS} characters of line 1 was cut off`,
    );
  });

  it("names the dropped line, not line 1, when a newline-placed cut drops whole lines", () => {
    // Only the character cap fires, but the cut lands on a newline, so the loss
    // is whole lines — reporting it as "line 1 was cut" would be wrong.
    const lines = Array.from({ length: 120 }, (_, i) =>
      `${i}`.padEnd(300, "x"),
    );
    const result = truncateEntrypointContent(lines.join("\n"));

    expect(result.wasLineTruncated).toBe(false);
    expect(result.wasCharTruncated).toBe(true);
    expect(result.content).not.toContain("of line 1 was cut off");
    expect(result.content).toContain(
      `of ${lines.length} lines were cut off, starting at line`,
    );
  });

  it("measures the original size, not the line-truncated size", () => {
    // 300 lines of 100 chars: the first 200 lines stay under the character cap,
    // so measuring after the line truncation would report an index that is
    // actually oversized as fine. Both caps must be evaluated up front.
    const lines = Array.from({ length: 300 }, (_, i) =>
      `${i}`.padEnd(100, "z"),
    );
    const result = truncateEntrypointContent(lines.join("\n"));

    expect(result.wasLineTruncated).toBe(true);
    expect(result.wasCharTruncated).toBe(true);
    expect(result.content).toContain("300 lines and 30299 characters");
  });

  it("does not cut a line in half", () => {
    // Each line is 300 chars, so the character cap lands mid-line; the cut
    // must move back to the preceding newline instead.
    const lines = Array.from({ length: 200 }, (_, i) =>
      `${i}`.padEnd(300, "x"),
    );
    const result = truncateEntrypointContent(lines.join("\n"));

    expect(result.wasCharTruncated).toBe(true);
    const body = result.content.split("\n\n> WARNING:")[0];
    expect(body.endsWith("x")).toBe(true);
    expect(body.length).toBeLessThanOrEqual(MAX_MEMORY_ENTRYPOINT_CHARS);
    for (const line of body.split("\n")) {
      expect(line).toHaveLength(300);
    }
  });

  it("names both caps when both fire", () => {
    const lines = Array.from({ length: 300 }, (_, i) =>
      `${i}`.padEnd(300, "x"),
    );
    const result = truncateEntrypointContent(lines.join("\n"));

    expect(result.wasLineTruncated).toBe(true);
    expect(result.wasCharTruncated).toBe(true);
    expect(result.content).toContain("WARNING: MEMORY.md is 300 lines and");
  });
});
