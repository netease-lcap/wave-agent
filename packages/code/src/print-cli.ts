import {
  Agent,
  AgentCallbacks,
  hasUncommittedChanges,
  hasNewCommits,
  getDefaultRemoteBranch,
} from "wave-agent-sdk";
import { displayUsageSummary } from "./utils/usageSummary.js";
import { removeWorktree } from "./utils/worktree.js";
import { BaseAppProps } from "./types.js";

export interface PrintCliOptions extends BaseAppProps {
  restoreSessionId?: string;
  continueLastSession?: boolean;
  message?: string;
  showStats?: boolean;
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
    tools,
    worktreeSession,
    workdir,
    model,
  } = options;

  if (
    (!message || message.trim() === "") &&
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
  const subagentReasoningStates = new Map<string, boolean>();
  const subagentContentStates = new Map<string, boolean>();

  // Setup callbacks for agent
  const callbacks: AgentCallbacks = {
    onAssistantMessageAdded: () => {
      isReasoning = false;
      isContent = false;
      // Assistant message started - no content to output yet
      process.stdout.write("\n");
    },
    onAssistantReasoningUpdated: (chunk: string) => {
      if (!isReasoning) {
        process.stdout.write("💭 Reasoning:\n");
        isReasoning = true;
      }
      process.stdout.write(chunk);
    },
    onAssistantContentUpdated: (chunk: string) => {
      if (isReasoning && !isContent) {
        process.stdout.write("\n\n📝 Response:\n");
        isContent = true;
      }
      // FR-001: Stream content updates for real-time display - output only the new chunk
      process.stdout.write(chunk);
    },

    // Subagent message callbacks
    onSubagentAssistantMessageAdded: (subagentId: string) => {
      subagentReasoningStates.set(subagentId, false);
      subagentContentStates.set(subagentId, false);
      process.stdout.write("\n   ");
    },
    onSubagentAssistantReasoningUpdated: (
      subagentId: string,
      chunk: string,
    ) => {
      if (!subagentReasoningStates.get(subagentId)) {
        process.stdout.write("💭 Reasoning: ");
        subagentReasoningStates.set(subagentId, true);
      }
      process.stdout.write(chunk);
    },
    onSubagentAssistantContentUpdated: (subagentId: string, chunk: string) => {
      if (
        subagentReasoningStates.get(subagentId) &&
        !subagentContentStates.get(subagentId)
      ) {
        process.stdout.write("\n   📝 Response: ");
        subagentContentStates.set(subagentId, true);
      }
      process.stdout.write(chunk);
    },
    onSubagentUserMessageAdded: (
      _subagentId: string,
      params: { content: string },
    ) => {
      process.stdout.write(`\n   👤 User: ${params.content}\n`);
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
      tools,
      workdir,
      model,
      // 保持流式模式以获得更好的命令行用户体验
    });

    // Send message if provided and not empty
    if (message && message.trim() !== "") {
      await agent.sendMessage(message);
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

    // Destroy agent and exit after sendMessage completes
    await agent.destroy();

    // Handle worktree cleanup for print mode
    if (worktreeSession) {
      const cwd = workdir || worktreeSession.path;
      const baseBranch = getDefaultRemoteBranch(cwd);
      const hasChanges = hasUncommittedChanges(cwd);
      const hasCommits = hasNewCommits(cwd, baseBranch);

      if (!hasChanges && !hasCommits) {
        removeWorktree(worktreeSession);
      } else {
        process.stdout.write(
          `\n⚠️ Worktree '${worktreeSession.name}' has changes or commits. Keeping it at: ${worktreeSession.path}\n`,
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

      await agent.destroy();

      // Handle worktree cleanup for print mode even on error
      if (worktreeSession) {
        const cwd = workdir || worktreeSession.path;
        const baseBranch = getDefaultRemoteBranch(cwd);
        const hasChanges = hasUncommittedChanges(cwd);
        const hasCommits = hasNewCommits(cwd, baseBranch);

        if (!hasChanges && !hasCommits) {
          removeWorktree(worktreeSession);
        } else {
          process.stdout.write(
            `\n⚠️ Worktree '${worktreeSession.name}' has changes or commits. Keeping it at: ${worktreeSession.path}\n`,
          );
        }
      }
    }
    process.exit(1);
  }
}
