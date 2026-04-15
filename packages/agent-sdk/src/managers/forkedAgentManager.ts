import { randomUUID } from "crypto";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import type { Message } from "../types/index.js";
import { logger } from "../utils/globalLogger.js";
import { Container } from "../utils/container.js";
import { SubagentManager, type SubagentInstance } from "./subagentManager.js";
import type { PermissionMode } from "../types/permissions.js";

export interface ForkedAgentEntry {
  id: string;
  instance: SubagentInstance;
  logPath: string;
  logStream?: fs.WriteStream;
  status: "running" | "completed" | "failed";
}

export interface ForkedAgentManagerCallbacks {
  onForkedAgentStatusChange?: (entries: ForkedAgentEntry[]) => void;
}

export class ForkedAgentManager {
  private activeForks = new Map<string, ForkedAgentEntry>();
  private callbacks: ForkedAgentManagerCallbacks;

  constructor(
    private container: Container,
    options: { callbacks?: ForkedAgentManagerCallbacks } = {},
  ) {
    this.callbacks = options.callbacks || {};
  }

  private get subagentManager(): SubagentManager {
    return this.container.get<SubagentManager>("SubagentManager")!;
  }

  /**
   * Creates a forked subagent with conversation history and executes it asynchronously (fire-and-forget).
   * Does NOT interact with BackgroundTaskManager.
   */
  async forkAndExecute(
    subagentType: string,
    messages: Message[],
    parameters: {
      description: string;
      allowedTools?: string[];
      model?: string;
      permissionModeOverride?: PermissionMode;
    },
    prompt: string,
  ): Promise<string> {
    const id = randomUUID();

    // Create log file for debugging
    const logPath = path.join(os.tmpdir(), `wave-forked-agent-${id}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: "a" });

    const entry: ForkedAgentEntry = {
      id,
      instance: {} as SubagentInstance, // Temporary placeholder
      logPath,
      logStream,
      status: "running",
    };
    this.activeForks.set(id, entry);

    // Fire-and-forget execution
    this.executeFork(entry, subagentType, messages, parameters, prompt).catch(
      (error) => {
        logger.error("Forked agent execution failed:", error);
      },
    );

    return id;
  }

  private async executeFork(
    entry: ForkedAgentEntry,
    subagentType: string,
    messages: Message[],
    parameters: {
      description: string;
      allowedTools?: string[];
      model?: string;
      permissionModeOverride?: PermissionMode;
    },
    prompt: string,
  ): Promise<void> {
    try {
      const configuration =
        await this.subagentManager.findSubagent(subagentType);
      if (!configuration) {
        throw new Error(`Subagent type ${subagentType} not found`);
      }

      const instance = await this.subagentManager.createInstance(
        configuration,
        {
          description: parameters.description,
          subagent_type: subagentType,
          prompt: "",
          allowedTools: parameters.allowedTools,
          model: parameters.model,
          permissionModeOverride: parameters.permissionModeOverride,
        },
        false,
      );

      // Pre-load the message manager with conversation history
      instance.messageManager.setMessages(messages);
      instance.logStream = entry.logStream;

      entry.instance = instance;

      // Execute the agent asynchronously
      const result = await this.subagentManager.executeAgent(
        instance,
        prompt,
        undefined,
        false, // NOT runInBackground — we handle logging ourselves
      );

      // Write final response and completion to log
      if (entry.logStream) {
        entry.logStream.write(
          `[${new Date().toISOString()}] Final response:\n${result}\n`,
        );
        entry.logStream.write(
          `[${new Date().toISOString()}] Agent completed successfully\n`,
        );
        entry.logStream.end();
      }

      entry.status = "completed";
      this.notifyChange();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (entry.logStream) {
        entry.logStream.write(
          `[${new Date().toISOString()}] Agent failed: ${errorMessage}\n`,
        );
        entry.logStream.end();
      }

      entry.status = "failed";
      this.notifyChange();
    }
  }

  /**
   * Abort a running forked agent.
   */
  stop(id: string): boolean {
    const entry = this.activeForks.get(id);
    if (!entry) {
      return false;
    }

    entry.instance?.aiManager?.abortAIMessage();
    entry.logStream?.destroy();
    this.activeForks.delete(id);
    this.notifyChange();
    return true;
  }

  /**
   * Stop all running forked agents and clear the map.
   */
  cleanup(): void {
    for (const [, entry] of this.activeForks) {
      entry.instance?.aiManager?.abortAIMessage();
      entry.logStream?.destroy();
    }
    this.activeForks.clear();
    this.notifyChange();
  }

  /**
   * Returns list of active forked agents.
   */
  getActiveForks(): ForkedAgentEntry[] {
    return Array.from(this.activeForks.values());
  }

  private notifyChange(): void {
    this.callbacks.onForkedAgentStatusChange?.(
      Array.from(this.activeForks.values()),
    );
  }
}
