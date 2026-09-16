import { describe, it, expect } from "vitest";
import { truncateEntrypointContent } from "../../src/utils/memoryEntrypoint.js";
import {
  MAX_MEMORY_ENTRYPOINT_CHARS,
  MAX_MEMORY_ENTRYPOINT_LINES,
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
    expect(result.content).toContain(`Line ${MAX_MEMORY_ENTRYPOINT_LINES}`);
    expect(result.content).not.toContain(
      `Line ${MAX_MEMORY_ENTRYPOINT_LINES + 1}`,
    );
    expect(result.content).toContain(
      `WARNING: MEMORY.md is ${lines.length} lines (limit: ${MAX_MEMORY_ENTRYPOINT_LINES})`,
    );
    expect(result.content).toContain("move detail into topic files");
  });

  it("truncates at the character cap when a single line is too long", () => {
    const result = truncateEntrypointContent("x".repeat(30_000));

    expect(result.wasLineTruncated).toBe(false);
    expect(result.wasCharTruncated).toBe(true);
    expect(result.content).toContain(
      `WARNING: MEMORY.md is 30000 characters (limit: ${MAX_MEMORY_ENTRYPOINT_CHARS}) — index entries are too long`,
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
