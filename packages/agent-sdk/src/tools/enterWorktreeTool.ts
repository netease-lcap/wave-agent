/**
 * EnterWorktree tool - creates an isolated git worktree and switches the session into it.
 * Mirrors Claude Code's EnterWorktree tool behavior and prompt.
 */

import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { type WorktreeSession } from "../utils/worktreeSession.js";
import {
  createWorktree,
  validateWorktreeName,
  generateWorktreeName,
  performPostCreationSetup,
} from "../utils/worktreeUtils.js";
import { getGitMainRepoRoot } from "../utils/gitUtils.js";
import { ENTER_WORKTREE_TOOL_NAME } from "../constants/tools.js";
import { logger } from "../utils/globalLogger.js";
import {
  executeWorktreeCreateHook,
  hasWorktreeCreateHook,
  WorktreeCreateHookError,
} from "../services/worktreeHooks.js";

/**
 * One-line diagnosis of a failed `WorktreeCreate` hook, for the tool's `error`
 * field — the only line a collapsed tool block shows in every host.
 *
 * Two things keep a naive cut from being useful:
 *
 * - The aggregated message leads with `<command>: `, which is already implied
 *   (this is the worktree tool) and eats the single line's width.
 * - A hook's stderr usually puts interpreter noise before the line that says
 *   what went wrong: `node:internal/modules/cjs/loader:1215`, `throw err;`,
 *   `^`, then `Error: Cannot find module '/…/worktree-create.mjs'`.
 *
 * So the hook's own output is preferred over the message, the first line that
 * reads like an error wins (falling back to the first non-empty line), and the
 * result is clipped to a single line's worth: this field must never make the
 * collapsed block grow.
 */
function hookDiagnosis(error: unknown, maxLength = 80): string {
  const output =
    error instanceof WorktreeCreateHookError
      ? error.outputs.join("\n")
      : error instanceof Error
        ? error.message.trim()
        : "";
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const diagnosis = lines.find((line) => /error/i.test(line)) ?? lines[0];
  if (!diagnosis) return "WorktreeCreate hook failed";
  return diagnosis.length <= maxLength
    ? diagnosis
    : `${diagnosis.slice(0, maxLength - 1)}…`;
}

export const ENTER_WORKTREE_TOOL_PROMPT = `Use this tool ONLY when the user explicitly asks to work in a worktree. This tool creates an isolated git worktree and switches the current session into it.

## When to Use

- The user explicitly says "worktree" (e.g., "start a worktree", "work in a worktree", "create a worktree", "use a worktree")

## When NOT to Use

- The user asks to create a branch, switch branches, or work on a different branch — use git commands instead
- The user asks to fix a bug or work on a feature — use normal git workflow unless they specifically mention worktrees
- Never use this tool unless the user explicitly mentions "worktree"

## Requirements

- Must be in a git repository (or have a WorktreeCreate hook configured, in which case the hook creates the worktree)

## Behavior

- Creates a new git worktree inside \`.wave/worktrees/\` with a new branch based on HEAD
- When a WorktreeCreate hook is configured, the hook creates the worktree instead (its stdout provides the worktree path) and no git command runs
- Switches the session's working directory to the new worktree
- Use ExitWorktree to leave the worktree mid-session (keep or remove). On session exit, if still in the worktree, the user will be prompted to keep or remove it

## Parameters

- \`name\` (optional): A name for the worktree. Each "/"-separated segment may contain only letters, digits, dots, underscores, and dashes; max 64 chars total. A random name is generated if not provided.
`;

export const enterWorktreeTool: ToolPlugin = {
  name: ENTER_WORKTREE_TOOL_NAME,
  defer: true,
  searchHint:
    "work in a separate git worktree so the current checkout stays untouched",
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
  leanPrompt: `Create an isolated git worktree inside \`.wave/worktrees/\` and switch the session into it. Use this ONLY when the user explicitly asks to work in a worktree — never for a plain branch request or an ordinary feature or bug task.

- Requires a git repository, unless a WorktreeCreate hook is configured (the hook creates it instead).
- \`name\` is optional; a random name is generated when it is omitted.
- Use ExitWorktree to leave the worktree mid-session.`,
  prompt: () => ENTER_WORKTREE_TOOL_PROMPT,

  async execute(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    // Validate not already in a worktree created by this session
    if (context.aiManager?.getWorktreeSession()) {
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

    // Hook-based creation first (allows user-configured VCS, including non-git)
    const hookConfiguration = context.hookManager?.getConfiguration();
    if (hasWorktreeCreateHook(hookConfiguration)) {
      try {
        const { worktreePath } = await executeWorktreeCreateHook(
          name,
          hookConfiguration,
          {
            projectDir: context.workdir,
            // The session root the hook anchors its own paths to. context.workdir
            // follows the model's `cd`, so it is not a safe anchor here.
            sessionRoot:
              context.aiManager?.getOriginalWorkdir() ?? context.workdir,
            sessionId: context.sessionId ?? "",
            transcriptPath: context.messageManager?.getTranscriptPath?.() ?? "",
            env: Object.fromEntries(
              Object.entries(context.sessionEnv ?? process.env).filter(
                (e) => e[1] !== undefined,
              ),
            ) as Record<string, string>,
          },
        );

        // Hook-based worktrees skip post-creation setup; the hook script owns
        // initialization. repoRoot falls back to the workdir for non-git repos.
        const hookBasedSession: WorktreeSession = {
          originalCwd: context.workdir,
          worktreePath,
          worktreeBranch: "",
          worktreeName: name,
          isNew: true,
          repoRoot: getGitMainRepoRoot(context.workdir) ?? context.workdir,
          hookBased: true,
        };

        const aiManager = context.aiManager;
        if (aiManager) {
          aiManager.setWorktreeSession(hookBasedSession);
          aiManager.setCurrentWorkdir(worktreePath);
        }

        return {
          success: true,
          content: `Created worktree at ${worktreePath}. The session is now working in the worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted. WorktreeCreate hooks were executed.`,
        };
      } catch (error) {
        return {
          success: false,
          content: `Failed to create worktree: ${(error as Error).message}`,
          error: hookDiagnosis(error),
        };
      }
    }

    // Git-based fallback
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
    const baseRef = context.aiManager?.getWorktreeBaseRef?.();
    const worktreeInfo = createWorktree(name, mainRepoRoot, { baseRef });

    // Copy local settings (.wave/settings.local.json) and gitignored project
    // files (.worktreeinclude, e.g. .env/.mcp.json) into a new worktree —
    // mirrors the CLI createWorktree path. Best-effort, never fails the tool.
    if (worktreeInfo.isNew) {
      try {
        await performPostCreationSetup(
          worktreeInfo.path,
          worktreeInfo.repoRoot,
        );
      } catch (error) {
        logger?.warn("Worktree post-creation setup failed:", error);
      }
    }

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

    // Set per-session worktree state and update CWD via AIManager
    const aiManager = context.aiManager;
    if (aiManager) {
      aiManager.setWorktreeSession(session);
      aiManager.setCurrentWorkdir(worktreeInfo.path);
    }

    const branchInfo = worktreeInfo.branch
      ? ` on branch ${worktreeInfo.branch}`
      : "";

    return {
      success: true,
      content: `Created worktree at ${worktreeInfo.path}${branchInfo}. The session is now working in the worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted.`,
    };
  },
};
