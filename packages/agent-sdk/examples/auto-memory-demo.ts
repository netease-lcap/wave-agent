import { Agent } from "../src/agent.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

/**
 * Example to verify the Auto Memory Background Agent.
 * This script:
 * 1. Creates a temporary git repository.
 * 2. Initializes a Wave agent in that repository.
 * 3. Sends a message with "stable" information.
 * 4. Verifies that the background agent extracts and saves the memory.
 */
async function main() {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wave-auto-memory-demo-"),
  );
  console.log(`Created temporary directory: ${tempDir}`);

  try {
    // Initialize a git repo to ensure stable memory directory resolution
    execSync("git init", { cwd: tempDir, stdio: "ignore" });

    const agent = await Agent.create({
      workdir: tempDir,
      model: "gemini-2.5-flash",
      logger: {
        debug: (message: unknown, ...args: unknown[]) => {
          console.debug(`[DEBUG] ${message}`, ...args);
        },
        info: (message: unknown, ...args: unknown[]) => {
          console.info(`[INFO] ${message}`, ...args);
        },
        warn: (message: unknown, ...args: unknown[]) => {
          console.warn(`[WARN] ${message}`, ...args);
        },
        error: (message: unknown, ...args: unknown[]) => {
          console.error(`[ERROR] ${message}`, ...args);
        },
      },
      callbacks: {
        onAssistantContentUpdated: (chunk) => {
          process.stdout.write(chunk);
        },
        onSubagentAssistantContentUpdated: (subagentId, chunk) => {
          // We can see the background agent working!
          process.stdout.write(
            `\x1b[2m[Background Memory Agent] ${chunk}\x1b[0m`,
          );
        },
      },
    });

    console.log("\n--- Sending message with memory-worthy information ---\n");

    // Provide some project-specific information that should be remembered
    await agent.sendMessage(
      "In this project, we always use 'pnpm' for package management and 'vitest' for testing. Please acknowledge this.",
    );

    console.log(
      "\n\n--- Waiting for background memory extraction to complete ---\n",
    );

    // The background agent runs after the turn ends.
    // Since we don't have a direct "onBackgroundAgentFinished" callback in the main Agent API yet,
    // we'll wait a bit and then check the memory directory.
    await new Promise((resolve) => setTimeout(resolve, 30000));

    // Resolve memory directory (internal logic duplicated for verification)
    const { MemoryService: MemoryServiceClass } = await import(
      "../src/services/memory.js"
    );
    const container = (
      agent as unknown as { container: { get: (name: string) => unknown } }
    ).container;
    const memoryService = container.get("MemoryService") as InstanceType<
      typeof MemoryServiceClass
    >;
    console.log(`MemoryService type check: ${!!MemoryServiceClass}`);
    const memoryDir = memoryService.getAutoMemoryDirectory(tempDir);
    const memoryFile = path.join(memoryDir, "MEMORY.md");

    console.log(`Checking memory file: ${memoryFile}`);

    try {
      const files = await fs.readdir(memoryDir);
      console.log(`\nFiles in memory directory: ${files.join(", ")}`);

      let allContent = "";
      for (const file of files) {
        if (file.endsWith(".md")) {
          const content = await fs.readFile(
            path.join(memoryDir, file),
            "utf-8",
          );
          allContent += `\n--- File: ${file} ---\n${content}\n`;
        }
      }

      console.log(allContent);

      if (
        allContent.toLowerCase().includes("pnpm") ||
        allContent.toLowerCase().includes("vitest")
      ) {
        console.log(
          "\x1b[32m✅ Success: Background agent correctly extracted the memory!\x1b[0m",
        );
      } else {
        console.log(
          "\x1b[31m❌ Failure: Background agent did not seem to extract the expected keywords.\x1b[0m",
        );
      }
    } catch (e) {
      console.log(
        "\x1b[31m❌ Failure: Could not read memory directory. Background agent might still be running or failed.\x1b[0m",
      );
      console.error(e);
    }

    await agent.destroy();
  } finally {
    // Clean up temp dir
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(`\nDeleted temporary directory: ${tempDir}`);
  }
}

main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
