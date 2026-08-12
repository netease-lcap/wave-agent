#!/usr/bin/env tsx

/**
 * Vision subagent end-to-end demo.
 *
 * Shows how Wave handles an image shared by the user when the MAIN model does
 * not support image recognition:
 *
 *   1. The image path is attached to the user message via sendMessage().
 *   2. convertMessagesForAPI() replaces the image with a text placeholder and
 *      appends `[Image source: <path>]` metadata (images are not sent to a
 *      non-vision model).
 *   3. The main model recognizes it cannot see the image and delegates to the
 *      builtin `vision` subagent through the Agent tool.
 *   4. The vision subagent runs on the model configured by WAVE_VISION_MODEL
 *      (e.g. qwen3.8-max), reads the image file with the Read tool, and
 *      returns a detailed text description.
 *
 * A test PNG (blue rectangle + red circle + "WAVE" text on a gray background)
 * is generated programmatically so the demo is self-contained — no real
 * screenshot needed.
 *
 * Requirements:
 *   - WAVE_VISION_MODEL must be set (settings.json env or environment) to a
 *     vision-capable model, otherwise the vision subagent is not registered.
 *   - The MAIN model (WAVE_MODEL / WAVE_FAST_MODEL) should NOT be
 *     vision-capable, so the delegation path is exercised. If it can see the
 *     image directly, the subagent is never invoked.
 *
 * Run: cd packages/agent-sdk && pnpm exec tsx examples/features/vision-subagent-demo.ts
 */

import { Agent } from "../../src/agent.js";
import { deflateSync } from "zlib";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile, rm, mkdir } from "fs/promises";

/** Minimal pure-Node PNG encoder (RGBA, no dependencies) so the demo can
 *  generate a real test image without external tools. */
function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  // CRC32 with precomputed table
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer): number => {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const typeBuf = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crc]);
  };

  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // compression/filter/interlace all default (0)

  // Each scanline is prefixed with filter byte 0 (None)
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 5x7 bitmap font used to draw the "WAVE" text into the test image. */
const FONT5X7: Record<string, string[]> = {
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "11011"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  V: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
};

function drawTestImage(width: number, height: number): Buffer {
  const rgba = Buffer.alloc(width * height * 4);
  // Light gray background
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = 236;
    rgba[i * 4 + 1] = 236;
    rgba[i * 4 + 2] = 236;
    rgba[i * 4 + 3] = 255;
  }
  const setPx = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const i = (y * width + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  };

  // Blue rectangle on the left
  for (let y = 60; y <= 145; y++) {
    for (let x = 20; x <= 100; x++) setPx(x, y, 30, 90, 220);
  }
  // Red circle on the right
  const cx = 165;
  const cy = 100;
  const radius = 35;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) {
        setPx(x, y, 220, 40, 40);
      }
    }
  }
  // Black "WAVE" text (scale 3) at the top
  const text = "WAVE";
  const scale = 3;
  let cursorX = 20;
  const originY = 20;
  for (const ch of text) {
    const glyph = FONT5X7[ch];
    if (!glyph) continue;
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === "1") {
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              setPx(
                cursorX + col * scale + dx,
                originY + row * scale + dy,
                0,
                0,
                0,
              );
            }
          }
        }
      }
    }
    cursorX += 5 * scale + scale; // char width + gap
  }

  return encodePng(width, height, rgba);
}

async function main() {
  const tempDir = join(tmpdir(), `vision-subagent-demo-${Date.now()}`);
  const imagePath = join(tempDir, "test-chart.png");
  let visionInvoked = false;
  // The Agent tool re-emits stage "running" on every subagent progress update
  // (live shortResult). Log each tool call only once to keep the output clean.
  const loggedRunningTools = new Set<string>();

  try {
    // 1. Generate a real test image: gray background, blue rectangle,
    //    red circle, "WAVE" text.
    await mkdir(tempDir, { recursive: true });
    await writeFile(imagePath, drawTestImage(220, 160));
    console.log(`🖼️  Generated test image: ${imagePath}\n`);

    const agent = await Agent.create({
      // Main model: keep it NON-vision so the delegation path is exercised.
      // WAVE_FAST_MODEL (e.g. deepseek-v4-flash) is vision-less, while the
      // vision subagent runs on WAVE_VISION_MODEL (e.g. qwen3.8-max).
      model: process.env.WAVE_FAST_MODEL,
      callbacks: {
        onToolBlockUpdated: (params) => {
          if (params.stage === "running") {
            if (loggedRunningTools.has(params.id)) return;
            loggedRunningTools.add(params.id);
            console.log(`\n🛠️  Main agent calling tool: ${params.name}...`);
          } else if (params.stage === "end") {
            console.log(
              `🛠️  Main agent tool ${params.name} ${params.success ? "success" : "failed"}.`,
            );
          }
        },
        onSubagentAssistantMessageAdded: (subagentId) => {
          const instance = agent.getSubagentInstance(subagentId);
          const name = instance?.configuration.name || subagentId;
          if (name === "vision") visionInvoked = true;
          console.log(`\n🤖 Subagent [${name}] started responding...`);
        },
        onSubagentAssistantContentUpdated: (params) => {
          const instance = agent.getSubagentInstance(params.subagentId);
          const name = instance?.configuration.name || params.subagentId;
          process.stdout.write(`[${name}] ${params.chunk}`);
        },
        onSubagentToolBlockUpdated: (subagentId, params) => {
          const instance = agent.getSubagentInstance(subagentId);
          const name = instance?.configuration.name || subagentId;
          if (params.stage === "running") {
            console.log(`\n[${name}] Calling tool: ${params.name}...`);
          } else if (params.stage === "end") {
            console.log(
              `[${name}] Tool ${params.name} ${params.success ? "success" : "failed"}.`,
            );
          }
        },
        onAssistantContentUpdated: (params) => {
          process.stdout.write(params.chunk);
        },
      },
    });

    try {
      console.log("💬 Sending image to the main agent (non-vision model)...\n");

      // 2. Share the image the same way a user pastes one: as a file path.
      //    The SDK converts it to "[Image source: <path>]" metadata for the
      //    main model and the model decides to delegate recognition to the
      //    vision subagent.
      await agent.sendMessage(
        "I've shared an image with you. Please describe its contents in detail (colors, shapes, any text).",
        [{ path: imagePath, mimeType: "image/png" }],
      );

      // 3. Check whether delegation actually happened
      console.log(
        `\n\n📊 Vision subagent ${visionInvoked ? "was invoked" : "was NOT invoked"}.`,
      );
    } finally {
      await agent.destroy();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    console.log("\n🧹 Demo complete");
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
  });
