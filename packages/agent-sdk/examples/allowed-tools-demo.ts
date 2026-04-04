#!/usr/bin/env tsx

/**
 * Allowed Tools Slash Command Example
 *
 * Demonstrates that tools listed in allowed-tools frontmatter are auto-approved.
 */

import { Agent } from "../src/agent.js";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, writeFile, rm } from "fs/promises";

const tempDir = join(tmpdir(), `allowed-tools-demo-${Date.now()}`);

console.log("🚀 Allowed Tools Slash Command Example");

// Setup temp project with custom command
await mkdir(join(tempDir, ".wave", "commands"), { recursive: true });

// Create a custom command with allowed-tools
await writeFile(
  join(tempDir, ".wave", "commands", "test-allowed.md"),
  `---
name: test-allowed
allowed-tools:
  - Write
---

Write "hello" to a file named "hello.txt".
`,
);

// Create another custom command WITHOUT allowed-tools
await writeFile(
  join(tempDir, ".wave", "commands", "test-restricted.md"),
  `---
name: test-restricted
---

Write "world" to a file named "world.txt".
`,
);

// Change to temp directory and create agent
process.chdir(tempDir);

let callbackCalled = false;

const agent = await Agent.create({
  permissionMode: "default",
  canUseTool: async (context) => {
    console.log(`\n🛡️ Permission callback called for: ${context.toolName}`);
    callbackCalled = true;
    return { behavior: "allow" };
  },
  callbacks: {
    onToolBlockUpdated: (params) => {
      if (params.stage === "running") {
        console.log(`\n🔧 Executing tool: ${params.name}`);
      }
    },
  },
});

async function main() {
  try {
    console.log(
      "\n--- Testing /test-allowed (should NOT trigger permission prompt) ---",
    );
    callbackCalled = false;
    await agent.sendMessage("/test-allowed");
    if (callbackCalled) {
      console.log("❌ FAILED: Permission callback was called for allowed tool");
    } else {
      console.log(
        "✅ SUCCESS: Permission callback was NOT called for allowed tool",
      );
    }

    console.log(
      "\n--- Testing /test-restricted (SHOULD trigger permission prompt) ---",
    );
    callbackCalled = false;
    await agent.sendMessage("/test-restricted");
    if (callbackCalled) {
      console.log(
        "✅ SUCCESS: Permission callback was called for restricted tool",
      );
    } else {
      console.log(
        "❌ FAILED: Permission callback was NOT called for restricted tool",
      );
    }
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await agent.destroy();
    await rm(tempDir, { recursive: true, force: true });
    console.log("\n🧹 Cleaned up");
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
