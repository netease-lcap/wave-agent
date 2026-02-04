#!/usr/bin/env tsx

/**
 * Basic Modular Rules Example
 *
 * This is a simple example showing how to set up and use modular rules.
 * It creates a temporary workspace with `.wave/rules/` directory and
 * demonstrates how rules are automatically loaded and applied.
 */

import { Agent } from "../src/agent.js";
import { mkdir, writeFile, rmdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

async function basicModularRulesExample(): Promise<void> {
  const testDir = join(tmpdir(), `modular-rules-basic-${Date.now()}`);
  let agent: Agent | undefined;

  try {
    // Step 1: Create workspace structure
    const waveRulesDir = join(testDir, ".wave", "rules");
    const srcDir = join(testDir, "src");
    await mkdir(waveRulesDir, { recursive: true });
    await mkdir(srcDir, { recursive: true });

    console.log("📁 Created workspace:", testDir);

    // Step 2: Create a global rule (applies to all files)
    await writeFile(
      join(waveRulesDir, "general.md"),
      `# General Coding Standards

- Write clear, readable code
- Add comments for complex logic
- Use meaningful variable names`,
    );

    console.log("✅ Created global rule: general.md");

    // Step 3: Create a path-specific rule (only for TypeScript files)
    await writeFile(
      join(waveRulesDir, "typescript.md"),
      `---
paths:
  - "src/**/*.ts"
---

# TypeScript Guidelines

- Use strict mode
- Avoid using 'any' type
- Define interfaces for complex objects`,
    );

    console.log("✅ Created path-specific rule: typescript.md");

    // Step 4: Create a sample file
    await writeFile(
      join(srcDir, "example.ts"),
      `function hello() {
  console.log("Hello");
}`,
    );

    console.log("✅ Created sample file: src/example.ts\n");

    // Step 5: Create agent and test
    console.log("🤖 Creating agent in workspace...\n");

    agent = await Agent.create({
      workdir: testDir,
      agentModel: "gemini-2.0-flash-exp",
      logger: {
        debug: (...args: unknown[]) => console.log("[DEBUG]", ...args),
        info: (...args: unknown[]) => console.log("[INFO]", ...args),
        warn: (...args: unknown[]) => console.warn("[WARN]", ...args),
        error: (...args: unknown[]) => console.error("[ERROR]", ...args),
      },
      callbacks: {
        onAssistantContentUpdated: (chunk: string) => {
          process.stdout.write(chunk);
        },
      },
    });

    console.log(
      "\n📋 Agent created - check debug logs above for loaded rules\n",
    );

    // Ask agent about the coding guidelines
    await agent.sendMessage(
      "What coding guidelines should I follow when working on src/example.ts? Please list all applicable rules from the memory.",
    );

    console.log("\n\n✅ Example completed!");
    console.log("\n💡 What happened:");
    console.log("   1. Created .wave/rules/ directory in workspace");
    console.log("   2. Added general.md (applies to all files)");
    console.log("   3. Added typescript.md (only for src/**/*.ts files)");
    console.log("   4. Agent automatically loaded both rules");
    console.log("   5. When working on src/example.ts, both rules are active");
  } catch (error) {
    console.error("❌ Error:", error);
    throw error;
  } finally {
    if (agent) {
      await agent.destroy();
    }
    if (existsSync(testDir)) {
      await rmdir(testDir, { recursive: true });
      console.log("🧹 Cleaned up workspace");
    }
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  basicModularRulesExample().catch((error) => {
    console.error("💥 Error:", error);
    process.exit(1);
  });
}

export { basicModularRulesExample };
