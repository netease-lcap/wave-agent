import { AIManager } from "./aiManager.js";
import { MessageManager } from "./messageManager.js";
import { ToolManager } from "./toolManager.js";
import type { Logger, CustomSlashCommandConfig } from "../types.js";
import type { BackgroundBashManager } from "./backgroundBashManager.js";
import {
  BashCommandResult,
  parseBashCommands,
  replaceBashCommandsWithOutput,
} from "../utils/markdownParser.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface SubAgentManagerOptions {
  mainMessageManager: MessageManager;
  toolManager: ToolManager;
  backgroundBashManager?: BackgroundBashManager;
  logger?: Logger;
}

/**
 * SubAgentManager handles isolated AI conversations for custom slash commands
 */
export class SubAgentManager {
  private mainMessageManager: MessageManager;
  private toolManager: ToolManager;
  private backgroundBashManager?: BackgroundBashManager;
  private logger?: Logger;

  constructor(options: SubAgentManagerOptions) {
    this.mainMessageManager = options.mainMessageManager;
    this.toolManager = options.toolManager;
    this.backgroundBashManager = options.backgroundBashManager;
    this.logger = options.logger;
  }

  /**
   * Execute a custom slash command with isolated context
   */
  async executeCustomCommand(
    commandName: string,
    content: string,
    config?: CustomSlashCommandConfig,
  ): Promise<void> {
    try {
      // Parse bash commands from the content
      const { commands, processedContent } = parseBashCommands(content);

      // Execute bash commands if any
      const bashResults: BashCommandResult[] = [];
      for (const command of commands) {
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: process.cwd(),
            timeout: 30000, // 30 second timeout
          });
          bashResults.push({
            command,
            output: stdout || stderr || "",
            exitCode: 0,
          });
        } catch (error) {
          const execError = error as {
            stdout?: string;
            stderr?: string;
            message?: string;
            code?: number;
          };
          bashResults.push({
            command,
            output:
              execError.stdout || execError.stderr || execError.message || "",
            exitCode: execError.code || 1,
          });
        }
      }

      // Replace bash command placeholders with their outputs
      const finalContent =
        bashResults.length > 0
          ? replaceBashCommandsWithOutput(processedContent, bashResults)
          : processedContent;

      // 立即创建空的 subAgent 消息，这样 UI 可以立即显示
      this.mainMessageManager.addSubAgentMessage(commandName, []);

      // Create isolated message manager for the sub-agent
      const subMessageManager = new MessageManager({
        callbacks: {
          // 当子对话有新消息时，更新主消息管理器中的 subAgent 消息
          onMessagesChange: (messages) => {
            // 更新主消息管理器中最后一个 subAgent 消息
            this.mainMessageManager.updateSubAgentMessages(
              commandName,
              messages,
            );
          },
        },
        logger: this.logger,
      });

      // Create isolated AI manager for the sub-agent
      const subAIManager = new AIManager({
        messageManager: subMessageManager,
        toolManager: this.toolManager,
        backgroundBashManager: this.backgroundBashManager,
        logger: this.logger,
        callbacks: {},
        model: config?.model, // 传递自定义模型
        allowedTools: config?.allowedTools, // 传递允许的工具列表
      });

      // 在子对话中添加自定义命令块显示
      subMessageManager.addCustomCommandMessage(commandName, finalContent);

      // Execute the AI conversation in the isolated context
      await subAIManager.sendAIMessage();
    } catch (error) {
      this.logger?.error(
        `Failed to execute custom command '${commandName}':`,
        error,
      );

      // Add error to main message manager
      this.mainMessageManager.addErrorBlock(
        `Failed to execute custom command '${commandName}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
