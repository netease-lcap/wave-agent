#!/usr/bin/env tsx

/**
 * Simple demo of readTool's image support
 *
 * This example demonstrates how the Wave Agent can read both text and image files
 * through natural language requests. The readTool automatically detects image files
 * and processes them for AI analysis.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { Agent } from "../src/agent.js";

console.log("🖼️ readTool Image Support Demo\n");

async function runDemo() {
  let tempDir: string | undefined;
  let agent: Agent | undefined;

  try {
    // Setup: Create test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "read-tool-demo-"));

    await fs.writeFile(
      path.join(tempDir, "sample.txt"),
      "Hello! This is a sample text file.",
    );

    // Create a minimal PNG image (1x1 pixel)
    const pngData = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
      0x09, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x01, 0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    await fs.writeFile(path.join(tempDir, "sample.png"), pngData);

    console.log(`📁 Created demo files in: ${tempDir}`);
    console.log("   📄 sample.txt (text file)");
    console.log("   🖼️ sample.png (image file)\n");

    // Create Agent
    agent = await Agent.create({
      model: "gemini-2.5-flash",
      callbacks: {
        onToolBlockUpdated: (params) => {
          if (params.stage === "start") {
            console.log(`🔧 ${params.name} tool called`);
          }
          if (params.result && params.result.includes("Image processed")) {
            console.log("   🖼️ Image processing detected!");
          }
        },
      },
    });

    console.log("🤖 Agent ready\n");

    // Demo 1: Read text file
    console.log("📝 Demo 1: Reading text file");
    await agent.sendMessage(
      `Please read this text file: ${path.join(tempDir, "sample.txt")}`,
    );
    console.log("   ✅ Text file read completed\n");

    // Demo 2: Read image file
    console.log("📝 Demo 2: Reading image file");
    await agent.sendMessage(
      `Please analyze this image: ${path.join(tempDir, "sample.png")}`,
    );
    console.log("   ✅ Image file read completed\n");

    console.log("🎉 Demo completed successfully!");
    console.log("\n💡 The readTool now supports:");
    console.log("   📄 Text files (as before)");
    console.log("   🖼️ Image files (PNG, JPEG, GIF, WEBP)");
    console.log("   📏 Size validation (20MB limit)");
    console.log("   🔍 Base64 encoding for AI analysis");
  } finally {
    // Cleanup
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
    if (agent) await agent.destroy();
  }
}

runDemo()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
  });
