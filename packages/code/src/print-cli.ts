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
import { describeWorktreeSurvival, removeWorktree } from "./utils/worktree.js";
import {
  drainStdout,
  installStdoutGuard,
  PrintOutput,
  uninstallStdoutGuard,
  type OutputFormat,
} from "./utils/printOutput.js";
import { BaseAppProps } from "./types.js";
import { readPipedStdin } from "./utils/stdin.js";

export interface PrintCliOptions extends BaseAppProps {
  restoreSessionId?: string;
  continueLastSession?: boolean;
  message?: string;
  /** MCP server config parsed from --mcp-config CLI argument */
  mcpServers?: Record<string, import("wave-agent-sdk").McpServerConfig>;
  /** --output-format: "text" (default), "json", or "stream-json" */
  outputFormat?: OutputFormat;
}

/** A diagnostics writer: always stderr — stdout carries the answer alone. */
type Writer = (text: string) => void;

export async function startPrintCli(options: PrintCliOptions): Promise<void> {
  // stdout carries the printed result here; console telemetry exporters would
  // mix structured telemetry into it — strip them at config resolution.
  setTelemetryStdoutProtected(true);
  const startTime = new Date();
  const {
    restoreSessionId,
    continueLastSession,
    message: promptArg,
    bypassPermissions,
    permissionMode,
    pluginDirs,
    additionalDirectories,
    skillsSources,
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

  // Piped stdin is extra prompt text, the way `claude -p` treats it — that is
  // what lets a long prompt (a whole spec, a SKILL.md) be fed without hitting
  // the kernel's per-argument limit (MAX_ARG_STRLEN = 128 KiB on Linux).
  const pipedPrompt = await readPipedStdin();
  // Only strings become prompt text: a non-string here (a caller bypassing the
  // types) must not silently turn into "true".
  const message = [promptArg, pipedPrompt]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join("\n");

  if (message.trim() === "" && !continueLastSession && !restoreSessionId) {
    console.error(
      "Print mode requires a message: use --print 'your message' or -p 'your message'",
    );
    process.exit(1);
  }

  const output = new PrintOutput({ format: outputFormat });
  // Structured modes promise stdout carries nothing but JSON, so a stray
  // console.log from anywhere in the process is diverted to stderr instead of
  // tearing the NDJSON stream. Text mode cannot be guarded that way (its answer
  // is plain text, indistinguishable from a stray line), so it relies on the
  // code discipline of never writing to stdout outside `PrintOutput`.
  if (output.structured) installStdoutGuard();
  // stdout carries the answer alone in every format, and the run prints no
  // progress at all (no reasoning, no `🔧` lines, no response headers) — that is
  // Claude Code's print-mode contract. Only diagnostics (error blocks, worktree
  // notes, usage/timing summary) go to stderr.
  const diag: Writer = (text) => output.diag(text);

  let agent: Agent;

  // Setup callbacks for agent. Like Claude Code's print mode, nothing about the
  // run's progress is printed — not to stdout, not to stderr. Reasoning never
  // reaches a stream (outside `stream-json`), tool calls are only recorded for
  // the envelope's `tool_calls`, and the answer itself is written once at the
  // end by `PrintOutput.result()`. Subagent output stays internal: the main
  // agent folds the relevant parts into its own answer.
  const callbacks: AgentCallbacks = {
    onAssistantMessageAdded: () => {
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
      // 只有 stream-json 会把它变成事件；其余格式里推理不落地。
      output.reasoningDelta(params.messageId, params.chunk);
    },
    onAssistantContentUpdated: (params: {
      messageId: string;
      chunk: string;
    }) => {
      output.contentDelta(params.messageId, params.chunk);
    },

    // Tool calls are recorded for `tool_calls` / `tool` events, never printed.
    onToolBlockUpdated: (params) => {
      output.toolUpdate(params);
    },

    // Notice callback: `error` is the turn failure, `info` a hook's line for
    // the human. Only the former is an error for the CLI's own output.
    onNoticeAdded: ({ level, content }) => {
      if (level !== "error") return;
      output.error(content);
      diag(`\n❌ Error: ${content}\n`);
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
      skillsSources,
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
    const usages = readUsages(agent);
    let sessionId = "";
    try {
      sessionId = agent.sessionId;
    } catch {
      // Same rule as the usage table: identity loss is not a run failure
    }

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

    // Destroy agent and exit after sendMessage completes. Drain the auto-memory
    // extraction the last turn forked first: this process is about to exit, so
    // unlike an interactive quit there is no "let it finish in the background"
    // option. Soft-bounded (60s), so a stuck model request still cannot hold the
    // exit.
    await agent.drainAutoMemory();
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
        // "Done." only when it is: removal is best-effort, and a surviving
        // directory (with its branch kept for it) needs the cleanup commands
        // printed rather than a success line over the leftovers.
        diag(
          (await removeWorktree(worktreeSession))
            ? "Done.\n"
            : `\n${describeWorktreeSurvival(worktreeSession)}\n`,
        );
      } catch (error) {
        // Never block print-mode exit on worktree cleanup failures
        diag(`\n⚠️ Skipping worktree removal: ${(error as Error).message}\n`);
      }
    }

    // The answer goes out last on stdout — in every format, and it is the only
    // thing written there; everything above went to stderr. The exit code reads
    // the envelope so "did this run fail" has one answer, not two: a
    // request-level failure (model unreachable, auth rejected) never throws out
    // of sendMessage — it only leaves an error block behind.
    const envelope = output.result({
      sessionId,
      durationMs: Date.now() - startTime.getTime(),
      usages: usages ?? [],
    });
    await exitWithFlushedStdout(envelope.is_error ? 1 : 0);
  } catch (error) {
    console.error("Failed to send message:", error);
    const reason = (error as Error)?.message ?? String(error);
    output.error(reason);

    // Claude Code 的加载失败路径（`emitLoadError`）：这次运行根本没起来
    // ——session id 非法、恢复失败、create 抛错——它一个字节都不写 stdout，
    // 原因只进 stderr。结构化格式仍出 envelope：它们必须保持可解析。
    if (!agent! && !output.structured) {
      output.diag(`${reason}\n`);
      await exitWithFlushedStdout(1);
      return;
    }

    let usages: Usage[] = [];
    let sessionId = "";

    if (agent!) {
      // A failed run still reports what it spent — the envelope's usage.
      try {
        usages = agent.usages;
        sessionId = agent.sessionId;
      } catch {
        // Silently ignore usage access errors
      }

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

      // Same ordering as the success path: drain the fork the last turn
      // started, then tear down. A failed run can still have left an
      // extraction in flight.
      await agent.drainAutoMemory();
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
          diag(
            (await removeWorktree(worktreeSession))
              ? "Done.\n"
              : `\n${describeWorktreeSurvival(worktreeSession)}\n`,
          );
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
    await exitWithFlushedStdout(envelope.is_error ? 1 : 0);
  }
}

/**
 * The agent's usage table, or `undefined` when the getter throws — usage is a
 * reporting detail, never a reason to turn a finished run into a failure.
 */
function readUsages(agent: Agent): Usage[] | undefined {
  try {
    return agent.usages;
  } catch {
    return undefined;
  }
}

/**
 * The answer goes out last on stdout in every format, so the queued write must
 * land before the process goes away: structured consumers would see a truncated
 * last line (parse error), text consumers a truncated answer. `uninstallStdoutGuard`
 * is the no-op half in text mode — it only ever installed in structured ones.
 */
async function exitWithFlushedStdout(code: number): Promise<void> {
  uninstallStdoutGuard();
  await drainStdout();
  process.exit(code);
}
