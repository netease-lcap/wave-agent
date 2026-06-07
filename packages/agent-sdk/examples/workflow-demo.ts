#!/usr/bin/env tsx

import fs from "fs/promises";
import path from "path";
import os from "os";
import { Agent } from "../src/agent.js";

/**
 * Workflow feature demonstration — real end-to-end with the Workflow tool.
 *
 * Creates a small sample project, then asks the agent to run a workflow
 * that explores it in parallel phases (scan → analyze → synthesize).
 *
 * Uses WAVE_FAST_MODEL for cheaper/faster testing if set.
 */

// Set up a small sample project for the workflow to explore
async function createSampleProject(dir: string) {
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.mkdir(path.join(dir, "tests"), { recursive: true });

  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "sample-calc",
        version: "1.0.0",
        description: "A simple calculator library",
        main: "src/index.js",
      },
      null,
      2,
    ),
  );

  await fs.writeFile(
    path.join(dir, "src", "index.js"),
    `export function add(a, b) { return a + b; }\nexport function subtract(a, b) { return a - b; }\nexport function multiply(a, b) { return a * b; }\nexport function divide(a, b) { if (b === 0) throw new Error("Division by zero"); return a / b; }\n`,
  );

  await fs.writeFile(
    path.join(dir, "src", "utils.js"),
    `export function clamp(val, min, max) { return Math.min(Math.max(val, min), max); }\nexport function range(start, end) { return Array.from({ length: end - start }, (_, i) => start + i); }\n`,
  );

  await fs.writeFile(
    path.join(dir, "tests", "calc.test.js"),
    `import { add, subtract, divide } from "../src/index.js";\nimport { clamp } from "../src/utils.js";\n\ntest("add", () => expect(add(1, 2)).toBe(3));\ntest("clamp", () => expect(clamp(5, 0, 10)).toBe(5));\n`,
  );

  await fs.writeFile(
    path.join(dir, "README.md"),
    "# Sample Calc\n\nA simple calculator library for demo purposes.\n",
  );
}

async function main() {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wave-workflow-demo-"),
  );
  console.log(`Sample project: ${tempDir}`);

  await createSampleProject(tempDir);

  const agent = await Agent.create({
    model: process.env.WAVE_FAST_MODEL,
    workdir: tempDir,
    callbacks: {
      onAssistantContentUpdated: (chunk) => {
        process.stdout.write(chunk);
      },
      onToolBlockUpdated: (params) => {
        if (params.stage === "start") {
          console.log(`\n[Tool: ${params.name}]`);
        }
        if (params.stage === "end" && params.shortResult) {
          console.log(`  -> ${params.shortResult}`);
        }
      },
    },
  });

  try {
    // Ask the agent to use a workflow to analyze the project
    await agent.sendMessage(
      "Run a workflow to explore this project. " +
        "Scan the directory structure, then analyze each source file in parallel, " +
        "then synthesize a project overview with architecture and module descriptions. " +
        "Use the Workflow tool with a script that uses agent(), pipeline(), and phase().",
    );

    // Check workflow status
    console.log("\n\n--- Checking workflow runs ---\n");
    await agent.sendMessage("/workflows");

    // Wait for workflow to complete
    console.log("\n\n--- Waiting 60s for workflow to complete... ---\n");
    await new Promise((r) => setTimeout(r, 60000));
    await agent.sendMessage(
      "Check if the workflow has completed. Show me the results.",
    );
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await agent.destroy();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    process.exit(0);
  }
}

process.on("SIGINT", async () => {
  process.exit(0);
});
process.on("SIGTERM", async () => {
  process.exit(0);
});

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
