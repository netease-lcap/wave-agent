import { describe, it, expect } from "vitest";
import { WindowsStreamDecoder, decodeBytes } from "@/utils/encoding.js";

function toBuffer(str: string): Buffer {
  return Buffer.from(str, "utf-8");
}

// GBK bytes for "成功: 已终止 PID 123" — the classic `taskkill` output on
// a zh-CN Windows system. Encoded as literal bytes so the test does not
// depend on the machine's own code page.
const GBK_TASKKILL = Buffer.from([
  0xb3, 0xc9, 0xb9, 0xa6, 0x3a, 0x20, 0xd2, 0xd1, 0xd6, 0xd5, 0xd6, 0xb9, 0x20,
  0x50, 0x49, 0x44, 0x20, 0x31, 0x32, 0x33,
]);

describe("decodeBytes", () => {
  it("decodes UTF-8 as-is", () => {
    expect(decodeBytes(toBuffer("hello 世界"))).toBe("hello 世界");
  });

  it("decodes GBK bytes with the U+FFFD fallback", () => {
    expect(decodeBytes(GBK_TASKKILL)).toBe("成功: 已终止 PID 123");
  });

  it("keeps ASCII and GBK mixed output intact", () => {
    const mixed = Buffer.concat([toBuffer("taskkill: "), GBK_TASKKILL]);
    expect(decodeBytes(mixed)).toBe("taskkill: 成功: 已终止 PID 123");
  });
});

describe("WindowsStreamDecoder", () => {
  it("decodes a pure UTF-8 stream chunk by chunk", () => {
    const decoder = new WindowsStreamDecoder();
    const out =
      decoder.push(toBuffer("line one\n")) +
      decoder.push(toBuffer("line two 世界\n")) +
      decoder.push(toBuffer("line three"));
    expect(out).toBe("line one\nline two 世界\nline three");
  });

  it("decodes a pure GBK stream chunk by chunk", () => {
    const decoder = new WindowsStreamDecoder();
    const out =
      decoder.push(GBK_TASKKILL.subarray(0, 5)) +
      decoder.push(GBK_TASKKILL.subarray(5));
    expect(out).toBe("成功: 已终止 PID 123");
  });

  it("does not misjudge a UTF-8 character split across chunk boundaries", () => {
    const decoder = new WindowsStreamDecoder();
    const utf8 = toBuffer("成功");
    // "成" and "功" are 3 bytes each: feed every byte one at a time
    let out = "";
    for (let i = 0; i < utf8.length; i++) {
      out += decoder.push(utf8.subarray(i, i + 1));
    }
    out += decoder.push(toBuffer(": ok"));
    expect(out).toBe("成功: ok");
  });

  it("switches to GBK mid-stream without losing earlier output", () => {
    const decoder = new WindowsStreamDecoder();
    const out = decoder.push(toBuffer("done\n")) + decoder.push(GBK_TASKKILL);
    expect(out).toBe("done\n成功: 已终止 PID 123");
  });

  it("flush() decodes a trailing split UTF-8 sequence", () => {
    const decoder = new WindowsStreamDecoder();
    const utf8 = toBuffer("ok 世");
    // "世" (3 bytes) split across chunks: "ok " is confirmed and emitted
    // immediately, the incomplete tail is held and decoded once complete
    const out =
      decoder.push(utf8.subarray(0, 4)) + // "ok " + first byte of 世
      decoder.push(utf8.subarray(4)) + // remaining 2 bytes of 世
      decoder.flush();
    expect(out).toBe("ok 世");
  });

  it("flush() decodes leftover GBK bytes after a switch", () => {
    const decoder = new WindowsStreamDecoder();
    decoder.push(GBK_TASKKILL);
    // GBK character "功" (0xB9 0xA6) split at the end of the stream
    expect(decoder.flush()).toBe("");
  });
});
