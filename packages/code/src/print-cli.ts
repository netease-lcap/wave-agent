import {
  Agent,
  AgentCallbacks,
  hasUncommittedChanges,
  hasNewCommits,
  getDefaultRemoteBranch,
  validateWorktreeRemovalPath,
  type WorktreeSession,
} from "wave-agent-sdk";
import { displayUsageSummary } from "./utils/usageSummary.js";
import { removeWorktree } from "./utils/worktree.js";
import { BaseAppProps } from "./types.js";

export interface PrintCliOptions extends BaseAppProps {
  restoreSessionId?: string;
  continueLastSession?: boolean;
  message?: string;
  showStats?: boolean;
  /** MCP server config parsed from --mcp-config CLI argument */
  mcpServers?: Record<string, import("wave-agent-sdk").McpServerConfig>;
}

function displayTimingInfo(startTime: Date, showStats: boolean): void {
  // Skip timing info in test environment or if stats are disabled
  if (process.env.NODE_ENV === "test" || process.env.VITEST || !showStats) {
    return;
  }

  const endTime = new Date();
  const duration = endTime.getTime() - startTime.getTime();

  process.stdout.write(`\n\n📅 Start time: ${startTime.toISOString()}\n`);
  process.stdout.write(`📅 End time: ${endTime.toISOString()}\n`);
  process.stdout.write(`⏱️  Duration: ${duration}ms\n`);
}

export async function startPrintCli(options: PrintCliOptions): Promise<void> {
  const startTime = new Date();
  const {
    restoreSessionId,
    continueLastSession,
    message,
    showStats = false,
    bypassPermissions,
    permissionMode,
    pluginDirs,
    additionalDirectories,
    tools,
    allowedTools,
    disallowedTools,
    worktreeSession,
    workdir,
    originalCwd,
    model,
    mcpServers,
  } = options;

  if (
    (typeof message !== "string" || message.trim() === "") &&
    !continueLastSession &&
    !restoreSessionId
  ) {
    console.error(
      "Print mode requires a message: use --print 'your message' or -p 'your message'",
    );
    process.exit(1);
  }

  let agent: Agent;
  let isReasoning = false;
  let isContent = false;

  // Setup callbacks for agent
  // Print mode only outputs the main agent's response (matching Claude Code's
  // behavior). Subagent output is internal — the main agent incorporates
  // relevant results in its own response.
  const callbacks: AgentCallbacks = {
    onAssistantMessageAdded: () => {
      isReasoning = false;
      isContent = false;
    },
    onAssistantReasoningUpdated: (params: { chunk: string }) => {
      if (!isReasoning) {
        process.stdout.write("\n💭 Reasoning:\n");
        isReasoning = true;
      }
      process.stdout.write(params.chunk);
    },
    onAssistantContentUpdated: (params: { chunk: string }) => {
      if (!isContent) {
        if (isReasoning) {
          process.stdout.write("\n\n📝 Response:\n");
        } else {
          process.stdout.write("\n");
        }
        isContent = true;
      }
      process.stdout.write(params.chunk);
    },

    // Tool block callback - display tool name when tool starts
    onToolBlockUpdated: (params) => {
      // Print tool name only during 'running' stage (happens once per tool call)
      if (params.stage === "running" && params.name) {
        process.stdout.write(`\n🔧 ${params.name}`);
        if (params.compactParams) {
          process.stdout.write(` ${params.compactParams}`);
        }
        process.stdout.write(`\n`);
      }
    },

    // Error block callback
    onErrorBlockAdded: (error: string) => {
      // Display error blocks with distinct formatting
      process.stdout.write(`\n❌ Error: ${error}\n`);
    },
  };

  try {
    // Initialize agent
    agent = await Agent.create({
      callbacks,
      restoreSessionId,
      continueLastSession,
      permissionMode:
        permissionMode || (bypassPermissions ? "bypassPermissions" : undefined),
      plugins: pluginDirs?.map((path) => ({ type: "local", path })),
      additionalDirectories,
      tools,
      allowedTools,
      disallowedTools,
      workdir,
      worktreeName: worktreeSession?.name,
      isNewWorktree: worktreeSession?.isNew,
      model,
      mcpServers,
      // 保持流式模式以获得更好的命令行用户体验
    });

    // Inject worktree session into this agent's container (per-session, not global)
    if (worktreeSession) {
      const session: WorktreeSession = {
        originalCwd: originalCwd ?? worktreeSession.repoRoot,
        worktreePath: worktreeSession.path,
        worktreeBranch: worktreeSession.branch,
        worktreeName: worktreeSession.name,
        isNew: worktreeSession.isNew,
        repoRoot: worktreeSession.repoRoot,
        hookBased: worktreeSession.hookBased,
      };
      agent.setWorktreeSession(session);
    }

    // Send message if provided and not empty
    if (typeof message === "string" && message.trim() !== "") {
      await agent.sendMessage(message);
      process.stdout.write("\n");
    }

    // Wait for running background tasks/subagents to complete AND for the main
    // agent to finish processing their completion notifications. The last
    // background task flips status to "completed" before its notification is
    // enqueued and before the main agent's follow-up turn runs, so
    // hasRunningBackgroundWork alone becomes false while the main agent is
    // still mid-turn — causing a TOCTOU race that aborts the final response.
    // Including isLoading and queued notifications closes that gap.
    while (
      agent.hasRunningBackgroundWork ||
      agent.isLoading ||
      agent.hasPendingMessages
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Display usage summary before exit
    if (showStats) {
      try {
        const usages = agent.usages;
        const sessionFilePath = agent.sessionFilePath;
        displayUsageSummary(usages, sessionFilePath);
      } catch {
        // Silently ignore usage summary errors
      }
    }

    // Display timing information
    displayTimingInfo(startTime, showStats);

    // Decide whether the worktree is clean enough to remove
    let cleanWorktree = false;
    if (worktreeSession) {
      const cwd = workdir || worktreeSession.path;
      const baseBranch = getDefaultRemoteBranch(cwd);
      const hasChanges = hasUncommittedChanges(cwd);
      const hasCommits = hasNewCommits(cwd, baseBranch);
      cleanWorktree = !hasChanges && !hasCommits;

      if (!cleanWorktree) {
        process.stdout.write(
          `\n⚠️ Worktree '${worktreeSession.name}' has changes or commits. Keeping it at: ${worktreeSession.path}\n`,
        );
      }
    }

    // Destroy agent and exit after sendMessage completes
    await agent.destroy();

    // Handle worktree cleanup for print mode (git removal stays after destroy)
    if (worktreeSession && cleanWorktree) {
      try {
        // Hook-based worktrees are owned by the hook; the git-root
        // containment check does not apply to them
        if (!worktreeSession.hookBased) {
          validateWorktreeRemovalPath(
            worktreeSession.path,
            worktreeSession.repoRoot,
          );
        }
        await removeWorktree(worktreeSession);
      } catch (error) {
        // Never block print-mode exit on worktree cleanup failures
        process.stdout.write(
          `\n⚠️ Skipping worktree removal: ${(error as Error).message}\n`,
        );
      }
    }

    process.exit(0);
  } catch (error) {
    console.error("Failed to send message:", error);
    if (agent!) {
      // Display usage summary even on error
      if (showStats) {
        try {
          const usages = agent.usages;
          const sessionFilePath = agent.sessionFilePath;
          displayUsageSummary(usages, sessionFilePath);
        } catch {
          // Silently ignore usage summary errors
        }
      }

      // Display timing information even on error
      displayTimingInfo(startTime, showStats);

      // Decide whether the worktree is clean enough to remove
      let cleanWorktree = false;
      if (worktreeSession) {
        const cwd = workdir || worktreeSession.path;
        const baseBranch = getDefaultRemoteBranch(cwd);
        const hasChanges = hasUncommittedChanges(cwd);
        const hasCommits = hasNewCommits(cwd, baseBranch);
        cleanWorktree = !hasChanges && !hasCommits;

        if (!cleanWorktree) {
          process.stdout.write(
            `\n⚠️ Worktree '${worktreeSession.name}' has changes or commits. Keeping it at: ${worktreeSession.path}\n`,
          );
        }
      }

      await agent.destroy();

      // Handle worktree cleanup for print mode even on error
      if (worktreeSession && cleanWorktree) {
        try {
          // Hook-based worktrees are owned by the hook; the git-root
          // containment check does not apply to them
          if (!worktreeSession.hookBased) {
            validateWorktreeRemovalPath(
              worktreeSession.path,
              worktreeSession.repoRoot,
            );
          }
          await removeWorktree(worktreeSession);
        } catch (error) {
          process.stdout.write(
            `\n⚠️ Skipping worktree removal: ${(error as Error).message}\n`,
          );
        }
      }
    }
    process.exit(1);
  }
}
