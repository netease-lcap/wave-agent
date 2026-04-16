import { loadSessionFromJsonl } from "./session.js";
import type { Logger, AgentOptions } from "../types/index.js";
import type { MessageManager } from "../managers/messageManager.js";
import type { SlashCommandManager } from "../managers/slashCommandManager.js";
import type { HookManager } from "../managers/hookManager.js";
import type { ConfigurationService } from "./configurationService.js";
import type { AIManager } from "../managers/aiManager.js";
import type { SubagentManager } from "../managers/subagentManager.js";
import type { TaskManager } from "./taskManager.js";
import type { NotificationQueue } from "../managers/notificationQueue.js";

export interface InteractionContext {
  messageManager: MessageManager;
  slashCommandManager: SlashCommandManager;
  hookManager: HookManager;
  workdir: string;
  configurationService: ConfigurationService;
  logger?: Logger;
  aiManager: AIManager;
  subagentManager: SubagentManager;
  taskManager: TaskManager;
  options: AgentOptions;
  abortMessage: () => void;
}

export class InteractionService {
  public static async sendMessage(
    context: InteractionContext,
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
  ): Promise<void> {
    const {
      messageManager,
      slashCommandManager,
      hookManager,
      workdir,
      logger,
      aiManager,
    } = context;

    try {
      // Handle slash command - check if it's a slash command (starts with /)
      if (content.startsWith("/")) {
        const command = content.trim();
        if (!command || command === "/") return;

        // Parse and validate slash command
        const { isValid, commandId, args } =
          slashCommandManager.parseAndValidateSlashCommand(command);

        if (isValid && commandId !== undefined) {
          // Set loading state to prevent concurrent commands
          aiManager.setIsLoading(true);
          try {
            // Execute valid slash command
            await slashCommandManager.executeCommand(commandId, args);
          } finally {
            aiManager.setIsLoading(false);
          }

          return;
        }

        // If command doesn't exist, continue as normal message processing
        // Don't add to history, let normal message processing logic below handle it
      }

      // Inject pending notifications from background tasks
      const notificationQueue = context.aiManager["container"].has(
        "NotificationQueue",
      )
        ? context.aiManager["container"].get<NotificationQueue>(
            "NotificationQueue",
          )
        : undefined;
      if (notificationQueue && notificationQueue.hasPending()) {
        const notifications = notificationQueue.dequeueAll();
        for (const notification of notifications) {
          messageManager.addUserMessage({
            content: notification,
          });
        }
      }

      // Handle normal AI message
      // Add user message first, will automatically sync to UI
      messageManager.addUserMessage({
        content,
        images: images?.map((img) => ({
          path: img.path,
          mimeType: img.mimeType,
        })),
      });

      // Execute UserPromptSubmit hooks after adding the user message
      if (hookManager) {
        try {
          const hookResults = await hookManager.executeHooks(
            "UserPromptSubmit",
            {
              event: "UserPromptSubmit",
              projectDir: workdir,
              timestamp: new Date(),
              // UserPromptSubmit doesn't need toolName
              sessionId: messageManager.getSessionId(),
              transcriptPath: messageManager.getTranscriptPath(),
              cwd: workdir,
              userPrompt: content,
              env: Object.fromEntries(
                Object.entries(process.env).filter((e) => e[1] !== undefined),
              ) as Record<string, string>, // Include environment variables
            },
          );

          // Process hook results and determine if we should continue
          const processResult = hookManager.processHookResults(
            "UserPromptSubmit",
            hookResults,
            messageManager,
          );

          // If hook processing indicates we should block (exit code 2), stop here
          if (processResult.shouldBlock) {
            logger?.info(
              "UserPromptSubmit hook blocked prompt processing with error:",
              processResult.errorMessage,
            );
            return; // Don't send to AI
          }
        } catch (error) {
          logger?.warn("UserPromptSubmit hooks execution failed:", error);
          // Continue processing even if hooks fail
        }
      }

      // Send AI message
      await aiManager.sendAIMessage();
    } catch (error) {
      console.error("Failed to add user message:", error);
      // Loading state will be automatically updated by the useEffect that watches messages
    }
  }

  public static async restoreSession(
    context: InteractionContext,
    sessionId: string,
  ): Promise<void> {
    const {
      messageManager,
      logger,
      subagentManager,
      taskManager,
      options,
      abortMessage,
    } = context;

    // 1. Validation
    if (!sessionId || sessionId === messageManager.getSessionId()) {
      return; // No-op if session ID is invalid or already current
    }

    // 2. Auto-save current session
    try {
      await messageManager.saveSession();
    } catch (error) {
      logger?.warn("Failed to save current session before restore:", error);
      // Continue with restoration even if save fails
    }

    // 3. Load target session
    const sessionData = await loadSessionFromJsonl(
      sessionId,
      messageManager.getWorkdir(),
    );
    if (!sessionData) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 4. Clean current state
    abortMessage(); // Abort any running operations
    subagentManager.cleanup(); // Clean up active subagents

    // 5. Rebuild usage (in correct order)
    messageManager.rebuildUsageFromMessages(sessionData.messages);

    // 6. Initialize session state last
    messageManager.initializeFromSession(sessionData);

    // Update task manager with the root session ID to ensure continuity across compressions
    taskManager.setTaskListId(sessionData.rootSessionId || sessionData.id);

    // 7. Load tasks for the restored session
    const tasks = await taskManager.listTasks();
    options.callbacks?.onTasksChange?.(tasks);
  }
}
