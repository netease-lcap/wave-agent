import { describe, expect, it } from "vitest";
import {
  OUTBOUND_IMAGE_MAX_BASE64_BYTES,
  OUTBOUND_IMAGE_MAX_DIMENSION_PX,
  OUTBOUND_IMAGE_TARGET_RAW_BYTES,
  exceedsOutboundBudget,
  rawBytesFromDataUrl,
  resizedImageNote,
} from "../../src/utils/imageBudget.js";

/** A data URL whose base64 payload decodes to exactly `bytes` raw bytes. */
function dataUrlOfRawBytes(bytes: number, mime = "image/png"): string {
  return `data:${mime};base64,${Buffer.alloc(bytes).toString("base64")}`;
}

/** Payload length of a data URL — the characters the request actually carries. */
function payloadLength(dataUrl: string): number {
  return dataUrl.length - dataUrl.indexOf(",") - 1;
}

describe("outbound image budget constants", () => {
  it("pins the agreed budget (Claude Code parity)", () => {
    expect(OUTBOUND_IMAGE_MAX_DIMENSION_PX).toBe(2000);
    expect(OUTBOUND_IMAGE_MAX_BASE64_BYTES).toBe(5 * 1024 * 1024);
  });

  it("expresses the same budget in raw bytes via the 4/3 base64 inflation", () => {
    expect(OUTBOUND_IMAGE_TARGET_RAW_BYTES).toBe(3932160);
    expect((OUTBOUND_IMAGE_TARGET_RAW_BYTES * 4) / 3).toBe(
      OUTBOUND_IMAGE_MAX_BASE64_BYTES,
    );
    // The two units really meet at the boundary: a payload of exactly the raw
    // budget encodes to exactly the base64 budget.
    expect(
      payloadLength(dataUrlOfRawBytes(OUTBOUND_IMAGE_TARGET_RAW_BYTES)),
    ).toBe(OUTBOUND_IMAGE_MAX_BASE64_BYTES);
  });
});

describe("rawBytesFromDataUrl", () => {
  it("measures the base64 payload, not the whole data URL", () => {
    expect(rawBytesFromDataUrl(dataUrlOfRawBytes(3000))).toBe(3000);
    // A long mime prefix must not count toward the budget.
    const longPrefix = dataUrlOfRawBytes(3000, "image/x-some-very-long-name");
    expect(rawBytesFromDataUrl(longPrefix)).toBe(3000);
    expect(rawBytesFromDataUrl(longPrefix)).toBe(
      rawBytesFromDataUrl(dataUrlOfRawBytes(3000)),
    );
  });

  it("accepts a bare payload without the data URL prefix", () => {
    expect(rawBytesFromDataUrl(Buffer.alloc(3).toString("base64"))).toBe(3);
    expect(rawBytesFromDataUrl("")).toBe(0);
  });
});

describe("exceedsOutboundBudget", () => {
  const small = dataUrlOfRawBytes(3000);

  it("keeps an image that is inside both budgets", () => {
    expect(exceedsOutboundBudget(small, { width: 2000, height: 2000 })).toBe(
      false,
    );
    expect(exceedsOutboundBudget(small)).toBe(false);
  });

  it("flags either side over the dimension budget", () => {
    expect(exceedsOutboundBudget(small, { width: 2001, height: 2000 })).toBe(
      true,
    );
    expect(exceedsOutboundBudget(small, { width: 2000, height: 2001 })).toBe(
      true,
    );
  });

  it("flags a payload over the byte budget, switching at ±1 byte", () => {
    expect(exceedsOutboundBudget(dataUrlOfRawBytes(3932160))).toBe(false);
    expect(exceedsOutboundBudget(dataUrlOfRawBytes(3932161))).toBe(true);
  });

  it("never treats unknown dimensions as oversized", () => {
    expect(exceedsOutboundBudget(small, undefined)).toBe(false);
  });
});

describe("resizedImageNote", () => {
  it("states the original size, the displayed size and the mapping factor", () => {
    const note = resizedImageNote(
      { width: 3000, height: 2000 },
      { width: 2000, height: 1333 },
    );
    expect(note.startsWith("[Image: ")).toBe(true);
    expect(note).toContain("original 3000x2000");
    expect(note).toContain("displayed at 2000x1333");
    expect(note).toContain("Multiply coordinates by 1.50");
  });

  it("reports the factor when only the height was over budget", () => {
    expect(
      resizedImageNote(
        { width: 1000, height: 4000 },
        { width: 500, height: 2000 },
      ),
    ).toContain("Multiply coordinates by 2.00");
  });
});
