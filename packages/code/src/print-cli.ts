import {
  Agent,
  AgentCallbacks,
  hasUncommittedChanges,
  hasNewCommits,
  getDefaultRemoteBranch,
  validateWorktreeRemovalPath,
  setTelemetryStdoutProtected,
  type Usage,
  type WorktreeSession,
} from "wave-agent-sdk";
import { displayUsageSummary } from "./utils/usageSummary.js";
import { removeWorktree } from "./utils/worktree.js";
import {
  drainStdout,
  installStdoutGuard,
  PrintOutput,
  uninstallStdoutGuard,
  type OutputFormat,
} from "./utils/printOutput.js";
import { BaseAppProps } from "./types.js";

export interface PrintCliOptions extends BaseAppProps {
  restoreSessionId?: string;
  continueLastSession?: boolean;
  message?: string;
  showStats?: boolean;
  /** MCP server config parsed from --mcp-config CLI argument */
  mcpServers?: Record<string, import("wave-agent-sdk").McpServerConfig>;
  /** --output-format: "text" (default), "json", or "stream-json" */
  outputFormat?: OutputFormat;
}

/** A diagnostics writer: stdout in text mode, stderr once stdout carries JSON. */
type Writer = (text: string) => void;

function displayTimingInfo(
  startTime: Date,
  showStats: boolean,
  write: Writer,
): void {
  // Skip timing info in test environment or if stats are disabled
  if (process.env.NODE_ENV === "test" || process.env.VITEST || !showStats) {
    return;
  }

  const endTime = new Date();
  const duration = endTime.getTime() - startTime.getTime();

  write(`\n\n📅 Start time: ${startTime.toISOString()}\n`);
  write(`📅 End time: ${endTime.toISOString()}\n`);
  write(`⏱️  Duration: ${duration}ms\n`);
}

export async function startPrintCli(options: PrintCliOptions): Promise<void> {
  // stdout carries the printed result here; console telemetry exporters would
  // mix structured telemetry into it — strip them at config resolution.
  setTelemetryStdoutProtected(true);
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
    outputFormat = "text",
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

  const output = new PrintOutput({ format: outputFormat });
  const structured = output.structured;
  // Structured modes promise stdout carries nothing but JSON, so a stray
  // console.log from anywhere in the process is diverted to stderr instead of
  // tearing the NDJSON stream.
  if (structured) installStdoutGuard();
  /** Diagnostics: stderr when stdout is the JSON channel, stdout otherwise. */
  const diag: Writer = (text) => output.diag(text);
  const usageWriter = structured
    ? toLineWriter(process.stderr.write.bind(process.stderr))
    : undefined;
  // Text mode keeps the exact call shape it had (console.log); structured mode
  // is the only one that redirects the summary, and it needs stderr for it.
  const showUsage = (usages: Usage[], sessionFilePath: string): void => {
    if (usageWriter) {
      displayUsageSummary(usages, sessionFilePath, usageWriter);
    } else {
      displayUsageSummary(usages, sessionFilePath);
    }
  };

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
      output.assistantMessageAdded();
    },
    onAssistantMessageDiscarded: () => {
      // 流式降级的半截消息作废，不能算进 result / num_turns
      output.assistantMessageDiscarded();
    },
    onAssistantReasoningUpdated: (params: {
      messageId: string;
      chunk: string;
    }) => {
      if (!isReasoning) {
        output.human("\n💭 Reasoning:\n");
        isReasoning = true;
      }
      output.human(params.chunk);
      output.reasoningDelta(params.messageId, params.chunk);
    },
    onAssistantContentUpdated: (params: {
      messageId: string;
      chunk: string;
    }) => {
      if (!isContent) {
        if (isReasoning) {
          output.human("\n\n📝 Response:\n");
        } else {
          output.human("\n");
        }
        isContent = true;
      }
      output.human(params.chunk);
      output.contentDelta(params.messageId, params.chunk);
    },

    // Tool block callback - display tool name when tool starts
    onToolBlockUpdated: (params) => {
      // Print tool name only during 'running' stage (happens once per tool call)
      if (params.stage === "running" && params.name) {
        output.human(`\n🔧 ${params.name}`);
        if (params.compactParams) {
          output.human(` ${params.compactParams}`);
        }
        output.human(`\n`);
      }
      output.toolUpdate(params);
    },

    // Error block callback
    onErrorBlockAdded: (error: string) => {
      // Display error blocks with distinct formatting
      output.error(error);
      diag(`\n❌ Error: ${error}\n`);
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
      entrypoint: "cli",
      // 保持流式模式以获得更好的命令行用户体验
    });

    // stream-json 的首事件：把会话元信息先交代清楚，CI 才能把后面的行归到一次运行上。
    // 只有这一种格式会读这些 getter，别的格式没必要为它解析一遍配置。
    if (outputFormat === "stream-json") {
      output.init({
        sessionId: agent.sessionId,
        model: agent.getModelConfig().model,
        cwd: agent.currentWorkdir,
        permissionMode: agent.getPermissionMode(),
        tools: agent.getAvailableToolNames(),
      });
    }

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
      output.human("\n");
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

    // Snapshot before destroy — the result envelope needs both, and the agent
    // is torn down before the worktree bookkeeping below. A getter that throws
    // must never turn a completed run into a failure, so it degrades to no
    // usage rather than raising.
    const usageSnapshot = readUsageSnapshot(agent);
    let sessionId = "";
    try {
      sessionId = agent.sessionId;
    } catch {
      // Same rule as the usage snapshot: identity loss is not a run failure
    }

    // Display usage summary before exit
    if (showStats && usageSnapshot) {
      try {
        showUsage(usageSnapshot.usages, usageSnapshot.sessionFilePath);
      } catch {
        // Silently ignore usage summary errors
      }
    }

    // Display timing information
    displayTimingInfo(startTime, showStats, diag);

    // Decide whether the worktree is clean enough to remove
    let cleanWorktree = false;
    if (worktreeSession) {
      const cwd = workdir || worktreeSession.path;
      const baseBranch = getDefaultRemoteBranch(cwd);
      const hasChanges = hasUncommittedChanges(cwd);
      const hasCommits = hasNewCommits(cwd, baseBranch);
      cleanWorktree = !hasChanges && !hasCommits;

      if (!cleanWorktree) {
        diag(
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
        diag("\nDeleting worktree ...\n");
        await removeWorktree(worktreeSession);
        diag("Done.\n");
      } catch (error) {
        // Never block print-mode exit on worktree cleanup failures
        diag(`\n⚠️ Skipping worktree removal: ${(error as Error).message}\n`);
      }
    }

    // The result line goes out last on stdout; everything above that is either
    // suppressed (structured) or on stderr. The exit code reads the envelope so
    // "did this run fail" has one answer, not two: a request-level failure (model
    // unreachable, auth rejected) never throws out of sendMessage — it only
    // leaves an error block behind.
    const envelope = output.result({
      sessionId,
      durationMs: Date.now() - startTime.getTime(),
      usages: usageSnapshot?.usages ?? [],
    });
    await exitWithFlushedStdout(structured, envelope.is_error ? 1 : 0);
  } catch (error) {
    console.error("Failed to send message:", error);
    output.error((error as Error)?.message ?? String(error));

    let usages: Usage[] = [];
    let sessionId = "";

    if (agent!) {
      // Display usage summary even on error
      try {
        usages = agent.usages;
        sessionId = agent.sessionId;
        const sessionFilePath = agent.sessionFilePath;
        if (showStats) {
          try {
            showUsage(usages, sessionFilePath);
          } catch {
            // Silently ignore usage summary errors
          }
        }
      } catch {
        // Silently ignore usage access errors
      }

      // Display timing information even on error
      displayTimingInfo(startTime, showStats, diag);

      // Decide whether the worktree is clean enough to remove
      let cleanWorktree = false;
      if (worktreeSession) {
        const cwd = workdir || worktreeSession.path;
        const baseBranch = getDefaultRemoteBranch(cwd);
        const hasChanges = hasUncommittedChanges(cwd);
        const hasCommits = hasNewCommits(cwd, baseBranch);
        cleanWorktree = !hasChanges && !hasCommits;

        if (!cleanWorktree) {
          diag(
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
          diag("\nDeleting worktree ...\n");
          await removeWorktree(worktreeSession);
          diag("Done.\n");
        } catch (error) {
          diag(`\n⚠️ Skipping worktree removal: ${(error as Error).message}\n`);
        }
      }
    }

    // A CI consumer must be able to read why the run failed off stdout, so a
    // failed run still emits its result envelope — just without `result`
    // (Claude Code's error variant does the same). This covers the case where
    // the agent never came up: no usages, no session id.
    const envelope = output.result({
      sessionId,
      durationMs: Date.now() - startTime.getTime(),
      usages,
      isError: true,
    });
    await exitWithFlushedStdout(structured, envelope.is_error ? 1 : 0);
  }
}

/**
 * The agent's usage table plus the transcript path, or `undefined` when either
 * getter throws — the summary is a convenience, not part of the run's contract.
 */
function readUsageSnapshot(
  agent: Agent,
): { usages: Usage[]; sessionFilePath: string } | undefined {
  try {
    return { usages: agent.usages, sessionFilePath: agent.sessionFilePath };
  } catch {
    return undefined;
  }
}

/**
 * Structured modes hand stdout to a consumer reading it line by line, so the
 * queued writes must land before the process goes away: a truncated last line
 * is a parse error on their side. Text mode keeps its existing exit path.
 */
async function exitWithFlushedStdout(
  structured: boolean,
  code: number,
): Promise<void> {
  if (structured) {
    uninstallStdoutGuard();
    await drainStdout();
  }
  process.exit(code);
}

/** Adapt a stream write to the line-writer shape `displayUsageSummary` takes. */
function toLineWriter(
  write: (chunk: string) => unknown,
): (line?: string) => void {
  return (line) => void write((line ?? "") + "\n");
}
