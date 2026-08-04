import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Container } from "../utils/container.js";
import { MessageManager } from "../managers/messageManager.js";
import { AIManager } from "../managers/aiManager.js";
import { MemoryService } from "./memory.js";
import { ConfigurationService } from "./configurationService.js";
import { logger } from "../utils/globalLogger.js";
import { isPathInside } from "../utils/pathSafety.js";
import { buildAutoMemoryExtractionPrompt } from "../prompts/autoMemoryExtraction.js";
import {
  READ_ONLY_COMMANDS,
  splitBashCommand,
  hasWriteRedirections,
  hasCommandSubstitution,
  hasProcessSubstitution,
  hasSedInPlace,
  isDangerousFind,
} from "../utils/bashParser.js";
import type { Message } from "../types/index.js";

/**
 * Message fed back to the extraction fork when the model requests a tool
 * outside the allowed set (Bash rm, MCP tools, Agent, out-of-dir writes...).
 */
const DENIED_TOOL_MESSAGE =
  "This tool call was denied during auto-memory extraction. Available tools: " +
  "Read, Grep, Glob, read-only Bash commands, and Write/Edit inside the " +
  "memory directory only.";

/**
 * Service responsible for managing the auto-memory background agent lifecycle.
 * Extracts and updates persistent project-level memory from conversation history.
 */
export class AutoMemoryService {
  private lastMemoryMessageId: string | null = null;
  private turnsSinceLastExtraction: number = 0;
  private extractionInProgress: boolean = false;
  private pendingExtraction: Promise<void> | null = null;

  constructor(private container: Container) {}

  private get messageManager(): MessageManager {
    return this.container.get<MessageManager>("MessageManager")!;
  }

  private get aiManager(): AIManager {
    return this.container.get<AIManager>("AIManager")!;
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
          if (
            b.type === "tool" &&
            (b.name === "Write" || b.name === "Edit") &&
            // Only a successful manual write counts as a manual update. A
            // denied/failed write didn't touch memory, so the extraction fork
            // must still run or the information is lost.
            b.success !== false
          ) {
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

    // 3. Concurrency guard: if an extraction is already in flight, skip this
    // turn. turnsSinceLastExtraction is intentionally NOT reset so the next
    // eligible turn retriggers the extraction.
    if (this.extractionInProgress) {
      logger.debug(
        "Skipping auto-memory extraction: another extraction is still in progress.",
      );
      return;
    }

    // 4. Trigger the perfect-fork extraction fire-and-forget. The message
    // snapshot and new-message count are computed now; lastMemoryMessageId
    // advances at trigger time so the next extraction starts from a later
    // window even while this one runs.
    const lastExtractedIndex = this.lastMemoryMessageId
      ? messages.findIndex((m) => m.id === this.lastMemoryMessageId)
      : -1;
    const newMessageCount =
      lastExtractedIndex === -1
        ? messages.length
        : messages.length - 1 - lastExtractedIndex;

    this.turnsSinceLastExtraction = 0;
    this.lastMemoryMessageId = messages[messages.length - 1].id || null;
    this.extractionInProgress = true;
    const extraction = this.runExtraction(workdir, messages, newMessageCount)
      .catch((error) => {
        logger.error("Auto-memory extraction failed:", error);
      })
      .finally(() => {
        this.extractionInProgress = false;
        this.pendingExtraction = null;
      });
    this.pendingExtraction = extraction;
  }

  /**
   * Wait for an in-flight extraction to settle. Called from Agent.dispose so
   * the process doesn't exit while the extraction fork is mid-flight.
   */
  async drain(): Promise<void> {
    await this.pendingExtraction;
  }

  /**
   * Initialize and execute the extraction in a perfect fork: same system
   * prompt, tools, model, and message prefix as the main conversation, so the
   * prompt cache is reused. A tool gate confines the fork to read-only
   * inspection and memory-directory writes. Runs in-process; callers treat it
   * as fire-and-forget.
   */
  private async runExtraction(
    workdir: string,
    messages: Message[],
    newMessageCount: number,
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

    const prompt = buildAutoMemoryExtractionPrompt(
      newMessageCount,
      existingMemoriesManifest,
    );

    await this.aiManager.runAutoMemoryFork(
      messages,
      `${prompt}\n\nThe memory directory for this project is: ${memoryDir}`,
      {
        maxTurns: 5, // Limit turns to prevent verification rabbit-holes
        canUseTool: (name, args) =>
          this.isAllowedForkTool(name, args, memoryDir, workdir),
        deniedToolMessage: DENIED_TOOL_MESSAGE,
      },
    );

    logger.debug("Auto-memory extraction completed.");
  }

  /**
   * Tool gate for the extraction fork: Read/Grep/Glob are always allowed;
   * Write/Edit only when the target path is inside the memory directory; Bash
   * only for read-only commands (aligned with the permission manager's
   * read-only bash classification). Everything else — Bash rm, MCP tools,
   * Agent, out-of-dir writes — is denied.
   */
  private isAllowedForkTool(
    name: string,
    args: Record<string, unknown>,
    memoryDir: string,
    workdir: string,
  ): boolean {
    if (name === "Read" || name === "Grep" || name === "Glob") {
      return true;
    }

    if (name === "Write" || name === "Edit") {
      const filePath = args.file_path ?? args.path;
      if (typeof filePath !== "string" || !filePath) return false;
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(workdir, filePath);
      return isPathInside(absolutePath, memoryDir);
    }

    if (name === "Bash") {
      const command = typeof args.command === "string" ? args.command : "";
      return this.isReadOnlyBashCommand(command);
    }

    return false;
  }

  /**
   * A bash command is read-only when every part is a READ_ONLY_COMMANDS entry
   * without write redirections, command/process substitution, sed -i, or
   * dangerous find flags. Mirrors PermissionManager.isAutoAllowedPart.
   */
  private isReadOnlyBashCommand(command: string): boolean {
    if (!command.trim()) return false;
    if (hasWriteRedirections(command)) return false;
    if (hasCommandSubstitution(command)) return false;
    if (hasProcessSubstitution(command)) return false;
    if (hasSedInPlace(command)) return false;

    const parts = splitBashCommand(command);
    if (parts.length === 0) return false;

    return parts.every((part) => {
      const trimmed = part.trim();
      if (!trimmed) return true;
      const commandMatch = trimmed.match(/^(\w+)(\s+.*)?$/);
      if (!commandMatch) return false;
      const cmd = commandMatch[1];
      if (!READ_ONLY_COMMANDS.includes(cmd)) return false;
      if (cmd === "find" && isDangerousFind(part)) return false;
      return true;
    });
  }
}
