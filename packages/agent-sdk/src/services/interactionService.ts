import { loadSessionFromJsonl } from "./session.js";
import type { Logger, AgentOptions, UserImage } from "../types/index.js";
import type { MessageManager } from "../managers/messageManager.js";
import type { SlashCommandManager } from "../managers/slashCommandManager.js";
import type { HookManager } from "../managers/hookManager.js";
import type { ConfigurationService } from "./configurationService.js";
import type { AIManager } from "../managers/aiManager.js";
import type { SubagentManager } from "../managers/subagentManager.js";
import type { TaskManager } from "./taskManager.js";
import type { ModManager } from "../managers/modManager.js";
import { wrapInSystemReminder } from "../prompts/planModeReminders.js";

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
  /**
   * 插件 MODS 的编排器（`prompt.submit` 的上下文注入用，spec「轮次内外的事件」）。
   * 可选：手工组装 context 的调用方（测试、纯服务调用）没有 mod 层。
   */
  modManager?: ModManager;
  options: AgentOptions;
  abortMessage: () => void;
  /**
   * Move every directory-derived piece of session state (session transcript
   * location, project rules, memory caches) to another working directory.
   * Used when restoring a session that lives in a different directory.
   */
  switchWorkdir: (workdir: string) => Promise<void>;
}

export class InteractionService {
  public static async sendMessage(
    context: InteractionContext,
    content: string,
    images?: UserImage[],
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
          // Execute valid slash command
          // Note: executeCommand sets isLoading early (e.g., custom commands set it
          // before bash execution). sendAIMessage() no longer guards against isLoading,
          // so callers can safely set it early without blocking subsequent AI calls.
          await slashCommandManager.executeCommand(commandId, args);

          return;
        }

        // If command doesn't exist, continue as normal message processing
        // Don't add to history, let normal message processing logic below handle it
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

      // Reserve loading state synchronously before any async work (hooks).
      // This closes the race window where a concurrent notification/message
      // could see isLoading=false during the await below and start a second
      // sendAIMessage. sendAIMessage's generation guard is the backstop, but
      // reserving here prevents the race at its source.
      aiManager.setIsLoading(true);

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
                Object.entries(
                  context.configurationService.getMergedEnv(),
                ).filter((e) => e[1] !== undefined),
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
            // Release the loading state we reserved above
            aiManager.setIsLoading(false);
            return; // Don't send to AI
          }
        } catch (error) {
          logger?.warn("UserPromptSubmit hooks execution failed:", error);
          // Continue processing even if hooks fail
        }
      }

      // Mods get one look at the user's prompt before this turn's request goes
      // out (`prompt.submit`, spec ecosystem/plugin-mods.md「轮次内外的事件」).
      // Their `context` rides the turn as one hidden meta message — the user's
      // own text stays exactly as typed, and the injected block never shows up
      // in the transcript UI.
      const injectedContext =
        (await context.modManager?.collectPromptContext(content)) ?? [];
      if (injectedContext.length > 0) {
        messageManager.addUserMessage({
          content: injectedContext.join("\n\n"),
          isMeta: true,
        });
      }

      // 影子事件 `classic.UserPromptSubmit`（spec「影子事件」）：与 `prompt.submit`
      // 同一时刻、之后发。只读 —— 不改用户原文、不丢弃这条 prompt，与
      // `prompt.submit` 同一条理由（钩子跑在界面看不到的地方，改/丢用户输入没法
      // 让用户察觉）。
      const modManager = context.modManager;
      if (modManager) {
        modManager.notifyMods("classic.UserPromptSubmit", { prompt: content });
      }

      // Send AI message
      await aiManager.sendAIMessage();
    } catch (error) {
      console.error("Failed to add user message:", error);
      // Ensure loading state is released on error
      aiManager.setIsLoading(false);
      // Loading state will be automatically updated by the useEffect that watches messages
    }
  }

  public static async restoreSession(
    context: InteractionContext,
    sessionId: string,
    restoreOptions?: { workdir?: string },
  ): Promise<void> {
    const {
      messageManager,
      hookManager,
      logger,
      subagentManager,
      taskManager,
      options,
      abortMessage,
      switchWorkdir,
    } = context;

    // The target session may live in another project directory. Everything
    // below that reads a path (loading the transcript, the SessionStart hook's
    // transcript path, the next append) must use the target directory, never
    // the current one — otherwise the switch writes a second copy of the same
    // session into the current project directory.
    const targetWorkdir =
      restoreOptions?.workdir ?? messageManager.getCurrentWorkdir();

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

    // 2b. Flush point for the session being left behind: it is about to be
    //     read from disk again by whoever lists sessions next.
    await messageManager.reAppendSessionMetadata();

    // 3. Run SessionEnd hooks for the current session (cleanup before switching)
    const currentSessionId = messageManager.getSessionId();
    const currentTranscriptPath = messageManager.getTranscriptPath();
    if (hookManager) {
      try {
        await hookManager.executeSessionEndHooks(
          "resume",
          currentSessionId,
          currentTranscriptPath,
        );
      } catch (error) {
        logger?.warn(
          `SessionEnd hooks on restore failed: ${(error as Error).message}`,
        );
      }
    }

    // 4. Load target session
    const sessionData = await loadSessionFromJsonl(sessionId, targetWorkdir);
    if (!sessionData) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 5. Move this session to the target directory. Only after the target
    //    transcript has loaded successfully, so a failed restore leaves the
    //    current session (and its directory) untouched.
    if (targetWorkdir !== messageManager.getCurrentWorkdir()) {
      await switchWorkdir(targetWorkdir);
    }

    // 6. Clean current state
    abortMessage(); // Abort any running operations
    subagentManager.cleanup(); // Clean up active subagents

    // 7. Rebuild usage (in correct order). The loader collected every assistant
    //    usage across the whole thread; `sessionData.messages` is only the tail
    //    from the last compaction, so deriving from it would lose the earlier half.
    messageManager.rebuildUsageFromMessages(
      sessionData.messages,
      sessionData.usages,
    );

    // 8. Initialize session state last
    messageManager.initializeFromSession(sessionData);
    // 8b. Flush point for the session we just took over. `initializeFromSession`
    //     has adopted the title recovered by the load-time whole-file scan, so
    //     this is where a title that had slid out of the tail window is written
    //     back at EOF (Claude Code's `adoptResumedSessionFile` does the same).
    await messageManager.reAppendSessionMetadata();

    // 9. Run SessionStart hooks for the restored session and inject additional
    //    context as a meta user message (matches Claude Code's resume behavior:
    //    SessionEnd then SessionStart, hook messages appended to the conversation)
    if (hookManager) {
      try {
        const sessionStartResult = await hookManager.executeSessionStartHooks(
          "resume",
          sessionData.id,
          messageManager.getTranscriptPath(),
        );
        if (sessionStartResult.additionalContext) {
          // `prompt.attachment` 的 `session-start` 档（spec
          // ecosystem/plugin-mods.md「系统提示词与附件」）：`null` 是「这条不要」，
          // 所以没有 ModManager 时的原文不能写成同一个 `??` 兜底。
          const sessionStartText = context.modManager
            ? await context.modManager.rewritePromptAttachment({
                type: "session-start",
                text: `SessionStart hook additional context: ${sessionStartResult.additionalContext}`,
              })
            : `SessionStart hook additional context: ${sessionStartResult.additionalContext}`;
          if (sessionStartText !== null) {
            messageManager.addUserMessage({
              content: wrapInSystemReminder(sessionStartText),
              isMeta: true,
            });
          }
        }
      } catch (error) {
        logger?.warn(
          `SessionStart hooks on restore failed: ${(error as Error).message}`,
        );
      }
    }

    // 影子事件 `classic.SessionStart`（spec「影子事件」）：恢复一场旧会话也是
    // 「开局」的一种，`source` 就是 `resume`。放在钩子块外面 —— 镜像不依赖
    // settings 钩子有没有跑成。
    context.modManager?.notifyMods("classic.SessionStart", {
      source: "resume",
    });

    // Update task manager with the root session ID to ensure continuity across compactions
    taskManager.setTaskListId(sessionData.id);

    // 10. Load tasks for the restored session
    const tasks = await taskManager.listTasks();
    options.callbacks?.onTasksChange?.(tasks);
  }
}
