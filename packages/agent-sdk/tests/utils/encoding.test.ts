import { describe, it, expect } from "vitest";
import { WindowsStreamDecoder, decodeBytes } from "@/utils/encoding.js";

function toBuffer(str: string): Buffer {
  return Buffer.from(str, "utf-8");
}

/** Feed `bytes` split at `cuts` (ascending, each < bytes.length), then flush. */
function decodeInChunks(bytes: Buffer, cuts: number[]): string {
  const decoder = new WindowsStreamDecoder();
  let out = "";
  let prev = 0;
  for (const cut of cuts) {
    out += decoder.push(bytes.subarray(prev, cut));
    prev = cut;
  }
  return out + decoder.push(bytes.subarray(prev)) + decoder.flush();
}

/** Report every failing cut so a failure names the boundary that broke. */
function expectCutsToMatch(
  bytes: Buffer,
  expected: string,
  cuts: number[][],
): void {
  const mismatches = cuts
    .map((cut) => ({ cut, got: decodeInChunks(bytes, cut) }))
    .filter(({ got }) => got !== expected)
    .map(({ cut, got }) => `cut@${cut.join("+")} -> ${JSON.stringify(got)}`);
  expect(mismatches).toEqual([]);
}

/** Ascending cut positions 1..len-1, one per possible boundary. */
function everyCut(length: number): number[][] {
  return Array.from({ length: length - 1 }, (_, i) => [i + 1]);
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

// The bytes of one character must not depend on where the pipe happened to
// hand them over. `decodeBytes` is the "one shot, no chunking" reference.
describe("WindowsStreamDecoder — UTF-8 output is chunk-boundary independent", () => {
  // 3-byte CJK, the real payload from the bug report; 4-byte emoji; ASCII
  // mixed in; a lone surrogate pair at the end.
  const SAMPLES = [
    "派活即交付第一批第二批第三批",
    "ok 派活 👋 done 验收",
    "🙂🙃😀",
    "plain ascii only\n",
  ];

  it.each(SAMPLES)("matches one-shot decoding for %j at every cut", (text) => {
    const bytes = toBuffer(text);
    const once = decodeBytes(bytes);
    expect(once).toBe(text);
    expectCutsToMatch(bytes, once, everyCut(bytes.length));
  });

  it("matches one-shot decoding for two cuts at every pair of positions", () => {
    const text = "a派👋b";
    const bytes = toBuffer(text);
    const pairs: number[][] = [];
    for (let first = 1; first < bytes.length; first++) {
      for (let second = first + 1; second < bytes.length; second++) {
        pairs.push([first, second]);
      }
    }
    expectCutsToMatch(bytes, text, pairs);
  });

  it("matches one-shot decoding when fed one byte at a time", () => {
    const text = "派活 👋 交付";
    const bytes = toBuffer(text);
    const everyByte = Array.from({ length: bytes.length - 1 }, (_, i) => i + 1);
    expectCutsToMatch(bytes, text, [everyByte]);
  });

  it.each(["é", "世", "🙂"])(
    "holds each partial prefix of %j instead of emitting it",
    (char) => {
      const bytes = toBuffer(char);
      for (let taken = 1; taken < bytes.length; taken++) {
        const decoder = new WindowsStreamDecoder();
        expect(decoder.push(bytes.subarray(0, taken))).toBe("");
        expect(decoder.push(bytes.subarray(taken))).toBe(char);
        expect(decoder.flush()).toBe("");
      }
    },
  );

  it.each(["é", "世", "🙂"])(
    "holds a chunk that ends exactly on %j's lead byte",
    (char) => {
      const decoder = new WindowsStreamDecoder();
      const bytes = toBuffer(`ok${char}`);
      // "ok" plus only the lead byte of the character: the ASCII part is
      // already decodable and must be emitted, the lead byte must be held.
      expect(decoder.push(bytes.subarray(0, 3))).toBe("ok");
      expect(decoder.push(bytes.subarray(3))).toBe(char);
    },
  );

  it("ends a stream cut off mid character with U+FFFD, not a GBK guess", () => {
    // `head -c 5` over "派活": 派 (3 bytes) plus 2 of 活's 3 bytes. Those two
    // bytes read as the GBK character 娲, so a GBK guess would invent a
    // character where the writer simply stopped.
    const decoder = new WindowsStreamDecoder();
    expect(decoder.push(toBuffer("派活").subarray(0, 5))).toBe("派");
    expect(decoder.flush()).toBe("\uFFFD");
  });
});

// #1753 must keep working: GBK bytes decode to Chinese, and a GBK double-byte
// character cut by a chunk boundary must not turn into U+FFFD.
describe("WindowsStreamDecoder — GBK streaming", () => {
  const GBK_TEXT = "成功: 已终止 PID 123";

  it("decodes pure GBK bytes", () => {
    expect(decodeInChunks(GBK_TASKKILL, [])).toBe(GBK_TEXT);
    expect(decodeBytes(GBK_TASKKILL)).toBe(GBK_TEXT);
  });

  it("keeps every double-byte character intact at every cut", () => {
    expectCutsToMatch(GBK_TASKKILL, GBK_TEXT, everyCut(GBK_TASKKILL.length));
  });

  it("keeps every double-byte character intact when fed one byte at a time", () => {
    const everyByte = Array.from(
      { length: GBK_TASKKILL.length - 1 },
      (_, i) => i + 1,
    );
    expectCutsToMatch(GBK_TASKKILL, GBK_TEXT, [everyByte]);
  });

  it("surfaces a dangling half character at flush instead of dropping it", () => {
    const decoder = new WindowsStreamDecoder();
    // 成 (0xB3 0xC9) followed by the orphaned lead byte of a 2-byte character.
    expect(decoder.push(Buffer.from([0xb3, 0xc9, 0xb9]))).toBe("成");
    expect(decoder.flush()).toBe("\uFFFD");
  });
});
