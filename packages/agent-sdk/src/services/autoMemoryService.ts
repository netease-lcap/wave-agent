import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Container } from "../utils/container.js";
import { MessageManager } from "../managers/messageManager.js";
import { ForkedAgentManager } from "../managers/forkedAgentManager.js";
import { MemoryService } from "./memory.js";
import { ConfigurationService } from "./configurationService.js";
import { logger } from "../utils/globalLogger.js";
import { isPathInside } from "../utils/pathSafety.js";
import { buildAutoMemoryExtractionPrompt } from "../prompts/autoMemoryExtraction.js";
import type { Message } from "../types/index.js";

/**
 * Service responsible for managing the auto-memory background agent lifecycle.
 * Extracts and updates persistent project-level memory from conversation history.
 */
export class AutoMemoryService {
  private lastMemoryMessageId: string | null = null;
  private turnsSinceLastExtraction: number = 0;

  constructor(private container: Container) {}

  private get messageManager(): MessageManager {
    return this.container.get<MessageManager>("MessageManager")!;
  }

  private get forkedAgentManager(): ForkedAgentManager {
    return this.container.get<ForkedAgentManager>("ForkedAgentManager")!;
  }

  private get memoryService(): MemoryService {
    return this.container.get<MemoryService>("MemoryService")!;
  }

  private get configurationService(): ConfigurationService {
    return this.container.get<ConfigurationService>("ConfigurationService")!;
  }

  /**
   * Called at the end of each conversation turn to trigger auto-memory extraction if needed.
   */
  async onTurnEnd(workdir: string): Promise<void> {
    if (!this.configurationService.resolveAutoMemoryEnabled()) {
      return;
    }

    this.turnsSinceLastExtraction++;

    const messages = this.messageManager.getMessages();
    if (messages.length === 0) return;

    // 1. Check if we should run based on throttling
    const frequency = this.configurationService.resolveAutoMemoryFrequency();
    if (this.turnsSinceLastExtraction < frequency) {
      return;
    }

    // 2. Check for mutual exclusion: skip if main agent manually updated memory in this turn
    const memoryDir = this.memoryService.getAutoMemoryDirectory(workdir);

    // Find messages since last extraction
    let startIndex = 0;
    if (this.lastMemoryMessageId) {
      startIndex =
        messages.findIndex((m) => m.id === this.lastMemoryMessageId) + 1;
      if (startIndex <= 0) startIndex = 0;
    }

    const recentMessages = messages.slice(startIndex);
    const hasManualMemoryWrite = recentMessages.some(
      (m) =>
        m.role === "assistant" &&
        m.blocks.some((b) => {
          if (b.type === "tool" && (b.name === "Write" || b.name === "Edit")) {
            try {
              const params = b.parameters ? JSON.parse(b.parameters) : null;
              const filePath = params?.file_path || params?.path;
              if (filePath) {
                const absolutePath = path.isAbsolute(filePath)
                  ? filePath
                  : path.resolve(workdir, filePath);
                return isPathInside(absolutePath, memoryDir);
              }
            } catch {
              return false;
            }
          }
          return false;
        }),
    );

    if (hasManualMemoryWrite) {
      logger.debug(
        "Skipping auto-memory extraction: manual memory write detected in this turn.",
      );
      this.lastMemoryMessageId = messages[messages.length - 1].id || null;
      this.turnsSinceLastExtraction = 0;
      return;
    }

    // 3. Trigger background extraction using a forked subagent
    try {
      await this.runExtraction(workdir, messages);
      this.lastMemoryMessageId = messages[messages.length - 1].id || null;
      this.turnsSinceLastExtraction = 0;
    } catch (error) {
      logger.error("Auto-memory extraction failed to trigger:", error);
    }
  }

  /**
   * Initialize and execute the background extraction subagent.
   */
  private async runExtraction(
    workdir: string,
    messages: Message[],
  ): Promise<void> {
    const memoryDir = this.memoryService.getAutoMemoryDirectory(workdir);

    // Ensure memory directory exists before starting
    await this.memoryService.ensureAutoMemoryDirectory(workdir);

    // Prepare manifest of existing memory files
    let existingMemoriesManifest = "";
    try {
      const files = await fs.readdir(memoryDir);
      existingMemoriesManifest = files
        .filter((f) => f.endsWith(".md"))
        .map((f) => `- ${f}`)
        .join("\n");
    } catch {
      // Ignore if directory doesn't exist yet
    }

    // Calculate how many new messages to analyze
    let newMessageCount = messages.length;
    if (this.lastMemoryMessageId) {
      const lastIndex = messages.findIndex(
        (m) => m.id === this.lastMemoryMessageId,
      );
      if (lastIndex !== -1) {
        newMessageCount = messages.length - 1 - lastIndex;
      }
    }

    const prompt = buildAutoMemoryExtractionPrompt(
      newMessageCount,
      existingMemoriesManifest,
    );

    // Execute the forked agent in background (fire-and-forget, decoupled from BackgroundTaskManager)
    await this.forkedAgentManager.forkAndExecute(
      "general-purpose",
      messages,
      {
        description: "Auto-memory extraction background agent",
        allowedTools: [
          "Read",
          "Glob",
          "Grep",
          `Write(${memoryDir}/**/*)`,
          `Edit(${memoryDir}/**/*)`,
          `Bash(rm ${memoryDir}/**/*)`,
        ],
        model: "fastModel", // Use fast model for background tasks to reduce latency and cost
        permissionModeOverride: "dontAsk", // Auto-deny out-of-scope writes without prompting user
        maxTurns: 5, // Limit turns to prevent verification rabbit-holes
      },
      `${prompt}\n\nThe memory directory for this project is: ${memoryDir}`,
    );

    logger.debug("Auto-memory extraction started in background.");
  }
}
