#!/usr/bin/env tsx

import fs from "fs/promises";
import path from "path";
import os from "os";
import { Agent } from "../src/agent.js";

console.log("🖼️ Testing readTool Image Support via Agent...\n");

let tempDir: string;
let agent: Agent;

async function setupTest() {
  // Create temporary directory
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-read-image-test-"));
  console.log(`📁 Created temporary directory: ${tempDir}`);

  // Create a simple text file
  await fs.writeFile(
    path.join(tempDir, "readme.txt"),
    "# Sample Text File\n\nThis is a demonstration text file.\nIt contains multiple lines to test text reading capabilities.\n\nThe readTool should process this as regular text content.",
  );

  // Create a simple PNG (1x1 red pixel)
  const pngData = Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // PNG signature
    0x00,
    0x00,
    0x00,
    0x0d,
    0x49,
    0x48,
    0x44,
    0x52, // IHDR chunk header
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x01, // Width: 1, Height: 1
    0x08,
    0x02,
    0x00,
    0x00,
    0x00,
    0x90,
    0x77,
    0x53,
    0xde, // Bit depth, color type, CRC
    0x00,
    0x00,
    0x00,
    0x09,
    0x49,
    0x44,
    0x41,
    0x54, // IDAT chunk header
    0x08,
    0xd7,
    0x63,
    0xf8,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01, // IDAT data
    0xe5,
    0x27,
    0xde,
    0xfc, // IDAT CRC
    0x00,
    0x00,
    0x00,
    0x00,
    0x49,
    0x45,
    0x4e,
    0x44, // IEND chunk header
    0xae,
    0x42,
    0x60,
    0x82, // IEND CRC
  ]);
  await fs.writeFile(path.join(tempDir, "sample.png"), pngData);

  console.log("✅ Created test files:");
  console.log(`   📄 ${path.join(tempDir, "readme.txt")} (text file)`);
  console.log(`   🖼️ ${path.join(tempDir, "sample.png")} (PNG image)`);
}

async function testWithAgent() {
  console.log("\n🤖 Creating Agent with detailed callbacks...");

  const toolCallLog: Array<{
    tool: string;
    file: string;
    result?: { success: boolean; hasImages: boolean; resultLength: number };
  }> = [];

  agent = await Agent.create({
    model: "gemini-2.5-flash",
    callbacks: {
      onToolBlockUpdated: (params) => {
        if (params.stage === "start") {
          console.log(`🔧 Tool started: ${params.name} (ID: ${params.id})`);
        }

        // Log parameters if available
        if (params.parametersChunk) {
          console.log(`📝 Parameters: ${params.parametersChunk}`);

          // Try to extract file path from parameters
          try {
            const paramData = JSON.parse(params.parametersChunk);
            if (paramData.file_path) {
              const fileName = path.basename(paramData.file_path);
              console.log(`   📁 Reading file: ${fileName}`);
              toolCallLog.push({
                tool: params.name || "unknown",
                file: fileName,
              });
            }
          } catch {
            // Parameters might not be JSON or complete yet
          }
        }

        // Log results
        if (params.result) {
          console.log(
            `📊 Tool result available (${params.result.length} chars)`,
          );

          // Update log with result info
          if (toolCallLog.length > 0) {
            const lastCall = toolCallLog[toolCallLog.length - 1];
            if (!lastCall.result) {
              lastCall.result = {
                success: !params.error,
                hasImages:
                  params.result.includes("🖼️") ||
                  params.result.includes("image"),
                resultLength: params.result.length,
              };

              if (lastCall.result.hasImages) {
                console.log(`   🖼️ Image processing detected!`);
              }
            }
          }
        }

        if (params.error) {
          console.log(`❌ Tool error: ${params.error}`);
        }
      },

      onAssistantContentUpdated: (chunk) => {
        // Show a small sample of the response
        if (chunk.length > 0) {
          process.stdout.write(".");
        }
      },
    },
  });

  console.log("✅ Agent ready\n");

  const tests = [
    {
      name: "Text File Analysis",
      message: `I have a text file that I need you to read and summarize. The file is located at: ${path.join(tempDir, "readme.txt")}\n\nPlease read this file and tell me what it contains.`,
      expectImages: false,
    },
    {
      name: "PNG Image Analysis",
      message: `I have a PNG image file that I need you to analyze. The image file is located at: ${path.join(tempDir, "sample.png")}\n\nPlease read this image file and describe what you can see in it.`,
      expectImages: true,
    },
  ];

  console.log("🧪 Running tests...\n");

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    console.log(`📝 Test ${i + 1}: ${test.name}`);
    console.log(`💬 Message: ${test.message.substring(0, 80)}...`);
    console.log(`🎯 Expecting images: ${test.expectImages ? "Yes" : "No"}`);

    try {
      console.log("🔄 Sending request");
      await agent.sendMessage(test.message);
      console.log(`\n✅ Request completed`);
    } catch (error) {
      console.log(`❌ Error: ${error}`);
    }

    console.log("");
  }

  // Show the tool call log
  console.log("📋 Tool Call Summary:");
  if (toolCallLog.length === 0) {
    console.log("   ⚠️ No tool calls detected");
    console.log("   💡 The Agent may not have used the readTool");
  } else {
    toolCallLog.forEach((call, i) => {
      console.log(`   ${i + 1}. ${call.tool} -> ${call.file}`);
      if (call.result) {
        console.log(
          `      Success: ${call.result.success}, Images: ${call.result.hasImages}, Size: ${call.result.resultLength}`,
        );
      }
    });
  }

  const imageProcessingCount = toolCallLog.filter(
    (call) => call.result?.hasImages,
  ).length;
  console.log(`\n🖼️ Image processing calls: ${imageProcessingCount}`);
  console.log(
    `${imageProcessingCount > 0 ? "✅" : "⚠️"} Image feature ${imageProcessingCount > 0 ? "working" : "may not be triggered"}`,
  );
}

async function cleanup() {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(`\n🧹 Cleaned up: ${tempDir}`);
  }

  if (agent) {
    await agent.destroy();
    console.log("🛑 Agent destroyed");
  }
}

async function main() {
  try {
    console.log("🚀 readTool Image Support Test\n");
    console.log("This example demonstrates:");
    console.log("• 📄 Reading text files via Agent messages");
    console.log("• 🖼️ Reading image files via Agent messages");
    console.log("• 🔧 Monitoring tool usage with callbacks");
    console.log("• 📊 Detecting image processing capabilities\n");

    await setupTest();
    await testWithAgent();

    console.log("\n🎉 Test completed!");
    console.log(
      "\n💡 Note: If no tools were called, the Agent may have decided",
    );
    console.log(
      "   not to read the files based on the current model behavior.",
    );
    console.log("   This doesn't mean the readTool image support is broken -");
    console.log(
      "   it means the Agent didn't think file reading was necessary.",
    );
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Interrupted, cleaning up...");
  await cleanup();
  process.exit(0);
});

main().catch(console.error);
