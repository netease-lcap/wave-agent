/**
 * Real-subprocess GBK decoding integration tests (issue #1753).
 *
 * The unit tests in tests/utils/encoding.test.ts feed synthetic buffers into
 * WindowsStreamDecoder. Here the bytes come from a real child process's
 * stdout pipe, exactly like a native Windows program (taskkill, ping, ...)
 * writing the OEM code page to the terminal on a zh-CN system.
 *
 * The child script embeds raw GBK byte arrays (no gbk *encoder* exists in
 * Node — only TextDecoder), so the tests run on every platform without extra
 * dependencies. The last test additionally drives bashTool end to end, which
 * only attaches the decoder on Windows — hence the skipIf guard.
 */

import { describe, it, expect } from "vitest";
import { spawn } from "child_process";

import { WindowsStreamDecoder } from "../../src/utils/encoding.js";

const isWindows = process.platform === "win32";

// GBK bytes for "成功: 已终止 PID 123" — the classic `taskkill` output on a
// zh-CN Windows system (same literal bytes as tests/utils/encoding.test.ts).
const GBK_TASKKILL: number[] = [
  0xb3, 0xc9, 0xb9, 0xa6, 0x3a, 0x20, 0xd2, 0xd1, 0xd6, 0xd5, 0xd6, 0xb9, 0x20,
  0x50, 0x49, 0x44, 0x20, 0x31, 0x32, 0x33,
];
// GBK bytes for "第一批第二批第三批" (18 bytes, 9 two-byte characters).
const GBK_BATCHES: number[] = [
  0xb5, 0xda, 0xd2, 0xbb, 0xc5, 0xfa, 0xb5, 0xda, 0xb6, 0xfe, 0xc5, 0xfa, 0xb5,
  0xda, 0xc8, 0xfd, 0xc5, 0xfa,
];

interface StreamResult {
  text: string;
  chunks: number;
}

/** Spawn a real node child, feed its stdout into the decoder as it arrives. */
function decodeChildStream(script: string): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    const decoder = new WindowsStreamDecoder();
    let text = "";
    let chunks = 0;

    const child = spawn(process.execPath, ["-e", script], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.stdout.on("data", (data: Buffer) => {
      chunks++;
      text += decoder.push(data);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`child node process exited with code ${code}`));
        return;
      }
      text += decoder.flush();
      resolve({ text, chunks });
    });
  });
}

function gbkBytesScript(bytes: number[]): string {
  return `process.stdout.write(Buffer.from([${bytes.join(",")}]))`;
}

describe("GBK decoding of a real subprocess stream", () => {
  it("decodes GBK bytes emitted by a real child process", async () => {
    const { text, chunks } = await decodeChildStream(
      gbkBytesScript(GBK_TASKKILL),
    );
    expect(chunks).toBeGreaterThan(0);
    expect(text).toBe("成功: 已终止 PID 123");
  });

  it("decodes a GBK stream delivered in multiple real chunks", async () => {
    // Written in three batches so the stdout pipe delivers separate chunks.
    // Batch boundaries are aligned to two-byte GBK character boundaries: the
    // decoder's chunk boundary hold-back logic only applies to the UTF-8
    // decision phase, so splitting mid-character is out of scope here.
    const bytes = GBK_BATCHES;
    const { text } = await decodeChildStream(
      `process.stdout.write(Buffer.from([${bytes.slice(0, 6).join(",")}]));` +
        `setTimeout(() => process.stdout.write(Buffer.from([${bytes
          .slice(6, 12)
          .join(",")}])), 30);` +
        `setTimeout(() => process.stdout.write(Buffer.from([${bytes
          .slice(12)
          .join(",")}])), 60);`,
    );
    expect(text).toBe("第一批第二批第三批");
  });

  it("does not misclassify UTF-8 child output as GBK", async () => {
    const { text } = await decodeChildStream(
      "process.stdout.write('hello 世界 UTF-8')",
    );
    expect(text).toBe("hello 世界 UTF-8");
  });
});

describe.skipIf(!isWindows)("bashTool decoding a real GBK subprocess", () => {
  it("returns decoded Chinese text for a GBK-emitting command", async () => {
    const { bashTool } = await import("../../src/tools/bashTool.js");
    const { createMockTaskManager } = await import(
      "../helpers/mockFactories.js"
    );
    const result = await bashTool.execute(
      {
        command: `node -e "${gbkBytesScript(GBK_TASKKILL).replace(/"/g, '\\"')}"`,
      },
      // Only fields the foreground path touches; no permission manager.
      {
        workdir: process.cwd(),
        taskManager: createMockTaskManager(),
      },
    );
    expect(result.success).toBe(true);
    expect(result.content).toContain("成功: 已终止 PID 123");
  });
});
