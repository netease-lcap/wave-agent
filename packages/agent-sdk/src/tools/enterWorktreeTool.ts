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
  getHeadCommit,
} from "../utils/worktreeUtils.js";
import { getGitMainRepoRoot } from "../utils/gitUtils.js";
import { ENTER_WORKTREE_TOOL_NAME } from "../constants/tools.js";
import { extractWorktreePath } from "../utils/worktreeHooks.js";

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

    const hasHook = context.hookManager?.hasHooks("WorktreeCreate") ?? false;

    let worktreePath: string;
    let branch: string;
    let repoRoot: string;
    let isNew: boolean;
    let originalHeadCommit: string | undefined;
    let hookBased: boolean;

    if (hasHook && context.hookManager) {
      const hookResults = await context.hookManager.executeHooks(
        "WorktreeCreate",
        {
          event: "WorktreeCreate",
          projectDir: mainRepoRoot,
          timestamp: new Date(),
          sessionId: context.sessionId ?? "",
          transcriptPath: context.messageManager?.getTranscriptPath() ?? "",
          cwd: mainRepoRoot,
          worktreeName: name,
          mainRepoDir: mainRepoRoot,
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

      if (hookResults.some((r) => !r.success)) {
        return {
          success: false,
          content: "WorktreeCreate hook failed. Check hook output for details.",
          error: "WorktreeCreate hook failed",
        };
      }

      // Extract worktree path from hook stdout
      const allStdout = hookResults.map((r) => r.stdout ?? "").join("\n");
      worktreePath = extractWorktreePath(allStdout) ?? "";
      if (!worktreePath) {
        return {
          success: false,
          content:
            "WorktreeCreate hook did not output a valid worktree path on stdout.",
          error: "WorktreeCreate hook produced no path",
        };
      }

      branch = `worktree-${name}`;
      repoRoot = mainRepoRoot;
      isNew = true;
      originalHeadCommit = getHeadCommit(mainRepoRoot);
      hookBased = true;
    } else {
      // No hook → git worktree add
      const worktreeInfo = createWorktree(name, mainRepoRoot);
      worktreePath = worktreeInfo.path;
      branch = worktreeInfo.branch;
      repoRoot = worktreeInfo.repoRoot;
      isNew = worktreeInfo.isNew;
      originalHeadCommit = worktreeInfo.originalHeadCommit;
      hookBased = false;
    }

    // Build session state
    const session: WorktreeSession = {
      originalCwd: context.workdir,
      worktreePath,
      worktreeBranch: branch,
      worktreeName: name,
      isNew,
      repoRoot,
      originalHeadCommit,
      hookBased,
    };

    // Set module-level session state
    setCurrentWorktreeSession(session);

    // Update CWD via AIManager
    const aiManager = context.aiManager;
    if (aiManager) {
      aiManager.setWorkdir(worktreePath);
    }

    const branchInfo = branch ? ` on branch ${branch}` : "";
    const hookInfo = hookBased ? " WorktreeCreate hooks were executed." : "";

    return {
      success: true,
      content: `Created worktree at ${worktreePath}${branchInfo}. The session is now working in the worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted.${hookInfo}`,
    };
  },
};
