import { describe, it, expect } from "vitest";
import {
  memoryAgeDays,
  memoryFreshnessNote,
  memoryFreshnessText,
} from "@/utils/memoryAge.js";

const DAY = 86_400_000;

describe("memoryAgeDays", () => {
  it("counts whole days elapsed", () => {
    const now = Date.now();

    expect(memoryAgeDays(now)).toBe(0);
    expect(memoryAgeDays(now - DAY)).toBe(1);
    expect(memoryAgeDays(now - 47 * DAY)).toBe(47);
  });

  it("floors partial days", () => {
    const now = Date.now();

    expect(memoryAgeDays(now - DAY + 3_600_000)).toBe(0);
    expect(memoryAgeDays(now - 2 * DAY + 3_600_000)).toBe(1);
  });

  it("clamps a future mtime (clock skew) to zero", () => {
    expect(memoryAgeDays(Date.now() + 5 * DAY)).toBe(0);
  });
});

describe("memoryFreshnessText", () => {
  it("stays silent for memories up to a day old", () => {
    const now = Date.now();

    expect(memoryFreshnessText(now)).toBe("");
    expect(memoryFreshnessText(now - DAY)).toBe("");
  });

  it("states the age and the caveat for older memories", () => {
    const text = memoryFreshnessText(Date.now() - 47 * DAY);

    expect(text).toContain("This memory is 47 days old.");
    expect(text).toContain("point-in-time observations, not live state");
    expect(text).toContain("Verify against current code before asserting");
  });

  it("is byte-stable for a fixed mtime within the same day", () => {
    const mtime = Date.now() - 47 * DAY;

    expect(memoryFreshnessText(mtime)).toBe(memoryFreshnessText(mtime));
    expect(memoryFreshnessText(mtime)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe("memoryFreshnessNote", () => {
  it("wraps the caveat in a system-reminder with a trailing newline", () => {
    const note = memoryFreshnessNote(Date.now() - 47 * DAY);

    expect(
      note.startsWith("<system-reminder>This memory is 47 days old."),
    ).toBe(true);
    expect(note.endsWith("</system-reminder>\n")).toBe(true);
  });

  it("returns an empty string when the memory is fresh", () => {
    expect(memoryFreshnessNote(Date.now())).toBe("");
  });
});
