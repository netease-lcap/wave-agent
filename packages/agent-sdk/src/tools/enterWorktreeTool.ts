/**
 * EnterWorktree tool - creates an isolated git worktree and switches the session into it.
 * Mirrors Claude Code's EnterWorktree tool behavior and prompt.
 */

import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import {
  getCurrentWorktreeSession,
  setCurrentWorktreeSession,
  type WorktreeSession,
} from "../utils/worktreeSession.js";
import {
  createWorktree,
  validateWorktreeName,
  generateWorktreeName,
} from "../utils/worktreeUtils.js";
import { getGitMainRepoRoot } from "../utils/gitUtils.js";
import { ENTER_WORKTREE_TOOL_NAME } from "../constants/tools.js";
import { logger } from "../utils/globalLogger.js";

export const ENTER_WORKTREE_TOOL_PROMPT = `Use this tool ONLY when the user explicitly asks to work in a worktree. This tool creates an isolated git worktree and switches the current session into it.

## When to Use

- The user explicitly says "worktree" (e.g., "start a worktree", "work in a worktree", "create a worktree", "use a worktree")

## When NOT to Use

- The user asks to create a branch, switch branches, or work on a different branch — use git commands instead
- The user asks to fix a bug or work on a feature — use normal git workflow unless they specifically mention worktrees
- Never use this tool unless the user explicitly mentions "worktree"

## Requirements

- Must be in a git repository
- Must not already be in a worktree

## Behavior

- Creates a new git worktree inside \`.wave/worktrees/\` with a new branch based on HEAD
- Switches the session's working directory to the new worktree
- Use ExitWorktree to leave the worktree mid-session (keep or remove). On session exit, if still in the worktree, the user will be prompted to keep or remove it

## Parameters

- \`name\` (optional): A name for the worktree. Each "/"-separated segment may contain only letters, digits, dots, underscores, and dashes; max 64 chars total. A random name is generated if not provided.
`;

export const enterWorktreeTool: ToolPlugin = {
  name: ENTER_WORKTREE_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: ENTER_WORKTREE_TOOL_NAME,
      description: ENTER_WORKTREE_TOOL_PROMPT,
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              'Optional name for the worktree. Each "/"-separated segment may contain only letters, digits, dots, underscores, and dashes; max 64 chars total. A random name is generated if not provided.',
          },
        },
      },
    },
  },
  prompt: () => ENTER_WORKTREE_TOOL_PROMPT,

  async execute(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    // Validate not already in a worktree created by this session
    if (getCurrentWorktreeSession()) {
      return {
        success: false,
        content:
          "Already in a worktree session. Use ExitWorktree to leave before creating a new one.",
        error: "Already in a worktree session",
      };
    }

    const name = (args.name as string) || generateWorktreeName();

    // Validate the worktree name
    try {
      validateWorktreeName(name);
    } catch (e) {
      return {
        success: false,
        content: `Invalid worktree name: ${(e as Error).message}`,
        error: `Invalid worktree name: ${(e as Error).message}`,
      };
    }

    // Resolve to main repo root so worktree creation works from within a subdirectory
    const mainRepoRoot = getGitMainRepoRoot(context.workdir);
    if (!mainRepoRoot) {
      return {
        success: false,
        content:
          "Cannot create a worktree: not in a git repository. Configure WorktreeCreate and WorktreeRemove hooks in settings.json to use worktree isolation with other VCS systems.",
        error: "Not in a git repository",
      };
    }

    // Create the worktree (captures originalHeadCommit internally)
    const worktreeInfo = createWorktree(name, mainRepoRoot);

    // Build session state
    const session: WorktreeSession = {
      originalCwd: context.workdir,
      worktreePath: worktreeInfo.path,
      worktreeBranch: worktreeInfo.branch,
      worktreeName: worktreeInfo.name,
      isNew: worktreeInfo.isNew,
      repoRoot: worktreeInfo.repoRoot,
      originalHeadCommit: worktreeInfo.originalHeadCommit,
    };

    // Set module-level session state
    setCurrentWorktreeSession(session);

    // Update CWD via AIManager
    const aiManager = context.aiManager;
    if (aiManager) {
      aiManager.setWorkdir(worktreeInfo.path);
    }

    // Also update the container's Workdir entry
    // (Container is not directly accessible from ToolContext, but AIManager.setWorkdir
    // handles both its internal field and process.chdir)

    // Trigger WorktreeCreate hook if worktree is new
    let hookTriggered = false;
    if (session.isNew && context.hookManager) {
      try {
        const hookResults = await context.hookManager.executeHooks(
          "WorktreeCreate",
          {
            event: "WorktreeCreate",
            projectDir: worktreeInfo.path,
            timestamp: new Date(),
            sessionId: context.sessionId ?? "",
            transcriptPath: context.messageManager?.getTranscriptPath() ?? "",
            cwd: worktreeInfo.path,
            worktreeName: worktreeInfo.name,
            env: Object.fromEntries(
              Object.entries(process.env).filter((e) => e[1] !== undefined),
            ) as Record<string, string>,
          },
        );

        if (context.messageManager) {
          context.hookManager.processHookResults(
            "WorktreeCreate",
            hookResults,
            context.messageManager,
          );
        }

        hookTriggered = true;
      } catch (error) {
        // Non-blocking: log but don't fail the tool
        logger?.warn("WorktreeCreate hooks execution failed:", error);
      }
    }

    const branchInfo = worktreeInfo.branch
      ? ` on branch ${worktreeInfo.branch}`
      : "";
    const hookInfo = hookTriggered
      ? " WorktreeCreate hooks were executed."
      : "";

    return {
      success: true,
      content: `Created worktree at ${worktreeInfo.path}${branchInfo}. The session is now working in the worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted.${hookInfo}`,
    };
  },
};
