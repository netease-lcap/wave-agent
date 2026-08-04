import { Agent } from "../../src/index.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { getGitCommonDir } from "../../src/utils/gitUtils.js";
import { pathEncoder } from "../../src/utils/pathEncoder.js";

/**
 * Example to verify the Auto Memory perfect-fork extraction.
 *
 * After each turn, the agent spawns a fork that shares the parent's prompt
 * cache (same system prompt, tools, model, and message prefix) and runs in
 * isolation with restricted tools: Read/Grep/Glob, read-only Bash, and
 * Write/Edit inside the memory directory only.
 *
 * This script:
 * 1. Creates a temporary git repository.
 * 2. Initializes a Wave agent in that repository.
 * 3. Sends a message with "stable" project information.
 * 4. Polls the auto-memory directory until the fork extracts the keywords.
 *
 * Usage:
 *   WAVE_FAST_MODEL=<model> pnpm exec tsx examples/features/auto-memory-demo.ts
 */
async function main() {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wave-auto-memory-demo-"),
  );
  console.log(`Created temporary directory: ${tempDir}`);

  let agent: Agent | undefined;

  try {
    // Initialize a git repo to ensure stable memory directory resolution
    execSync("git init", { cwd: tempDir, stdio: "ignore" });

    agent = await Agent.create({
      workdir: tempDir,
      model: process.env.WAVE_FAST_MODEL,
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
        onAssistantContentUpdated: (params) => {
          process.stdout.write(params.chunk);
        },
      },
    });

    // The auto-memory directory is derived deterministically from the git
    // common directory (same logic as MemoryService.getAutoMemoryDirectory).
    const commonDir = getGitCommonDir(tempDir);
    const projectRoot =
      path.basename(commonDir) === ".git" ? path.dirname(commonDir) : commonDir;
    const memoryDir = path.join(
      os.homedir(),
      ".wave",
      "projects",
      pathEncoder.encodeSync(projectRoot),
      "memory",
    );
    const memoryFile = path.join(memoryDir, "MEMORY.md");
    console.log(`Memory directory: ${memoryDir}`);

    console.log("\n--- Sending message with memory-worthy information ---\n");

    // Provide some project-specific information that should be remembered
    await agent.sendMessage(
      "In this project, we always use 'pnpm' for package management and 'vitest' for testing. Please acknowledge this.",
    );

    console.log(
      "\n\n--- Waiting for the auto-memory fork to extract the memory ---\n",
    );

    // The fork runs after the turn ends (fire-and-forget). Poll the memory
    // directory instead of waiting a fixed amount of time.
    let allContent = "";
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      try {
        const files = await fs.readdir(memoryDir);
        allContent = "";
        for (const file of files) {
          if (file.endsWith(".md")) {
            allContent += `\n--- File: ${file} ---\n${await fs.readFile(
              path.join(memoryDir, file),
              "utf-8",
            )}\n`;
          }
        }
        if (
          allContent.toLowerCase().includes("pnpm") ||
          allContent.toLowerCase().includes("vitest")
        ) {
          break;
        }
      } catch {
        // Memory directory may not exist yet; keep polling.
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(`Checking memory file: ${memoryFile}`);
    console.log(allContent);

    if (
      allContent.toLowerCase().includes("pnpm") ||
      allContent.toLowerCase().includes("vitest")
    ) {
      console.log(
        "\x1b[32m✅ Success: the auto-memory fork extracted the memory!\x1b[0m",
      );
    } else {
      console.log(
        "\x1b[31m❌ Failure: expected keywords (pnpm/vitest) were not extracted within 120s.\x1b[0m",
      );
    }
  } catch (error) {
    console.error("Error in example:", error);
  } finally {
    // destroy() drains any in-flight auto-memory extraction before cleanup
    if (agent) {
      await agent.destroy();
    }
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(`Deleted temporary directory: ${tempDir}`);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
