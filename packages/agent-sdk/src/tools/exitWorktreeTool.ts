/**
 * ExitWorktree tool - exits a worktree session and returns to the original directory.
 * Mirrors Claude Code's ExitWorktree tool behavior and prompt.
 */

import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import {
  getCurrentWorktreeSession,
  setCurrentWorktreeSession,
} from "../utils/worktreeSession.js";
import {
  removeWorktree,
  countWorktreeChanges,
} from "../utils/worktreeUtils.js";
import { EXIT_WORKTREE_TOOL_NAME } from "../constants/tools.js";

export const EXIT_WORKTREE_TOOL_PROMPT = `Exit a worktree session created by EnterWorktree and return the session to the original working directory.

## Scope

This tool ONLY operates on worktrees created by EnterWorktree in this session. It will NOT touch:
- Worktrees you created manually with \`git worktree add\`
- Worktrees from a previous session (even if created by EnterWorktree then)
- The directory you're in if EnterWorktree was never called

If called outside an EnterWorktree session, the tool is a **no-op**: it reports that no worktree session is active and takes no action. Filesystem state is unchanged.

## When to Use

- The user explicitly asks to "exit the worktree", "leave the worktree", "go back", or otherwise end the worktree session
- Do NOT call this proactively — only when the user asks

## Parameters

- \`action\` (required): \`"keep"\` or \`"remove"\`
  - \`"keep"\` — leave the worktree directory and branch intact on disk. Use this if the user wants to come back to the work later, or if there are changes to preserve.
  - \`"remove"\` — delete the worktree directory and its branch. Use this for a clean exit when the work is done or abandoned.
- \`discard_changes\` (optional, default false): only meaningful with \`action: "remove"\`. If the worktree has uncommitted files or commits not on the original branch, the tool will REFUSE to remove it unless this is set to \`true\`. If the tool returns an error listing changes, confirm with the user before re-invoking with \`discard_changes: true\`.

## Behavior

- Restores the session's working directory to where it was before EnterWorktree
- If action is "remove": deletes the worktree directory and branch
- Once exited, EnterWorktree can be called again to create a fresh worktree
`;

export const exitWorktreeTool: ToolPlugin = {
  name: EXIT_WORKTREE_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: EXIT_WORKTREE_TOOL_NAME,
      description: EXIT_WORKTREE_TOOL_PROMPT,
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["keep", "remove"],
            description:
              '"keep" leaves the worktree and branch on disk; "remove" deletes both.',
          },
          discard_changes: {
            type: "boolean",
            description:
              'Required true when action is "remove" and the worktree has uncommitted files or unmerged commits. The tool will refuse and list them otherwise.',
          },
        },
        required: ["action"],
      },
    },
  },
  prompt: () => EXIT_WORKTREE_TOOL_PROMPT,

  async execute(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const action = args.action as "keep" | "remove" | undefined;
    const discardChanges = (args.discard_changes as boolean) ?? false;

    if (!action) {
      return {
        success: false,
        content:
          'Missing required parameter: "action" must be "keep" or "remove".',
        error: 'Missing required parameter: "action"',
      };
    }

    // Validate: must be in an active worktree session
    const session = getCurrentWorktreeSession();
    if (!session) {
      return {
        success: false,
        content:
          "No-op: there is no active EnterWorktree session to exit. This tool only operates on worktrees created by EnterWorktree in the current session — it will not touch worktrees created manually or in a previous session. No filesystem changes were made.",
        error: "No active worktree session",
      };
    }

    // Safety check for removal with changes
    if (action === "remove" && !discardChanges) {
      const summary = countWorktreeChanges(
        session.worktreePath,
        session.originalHeadCommit,
      );
      if (summary === null) {
        return {
          success: false,
          content: `Could not verify worktree state at ${session.worktreePath}. Refusing to remove without explicit confirmation. Re-invoke with discard_changes: true to proceed — or use action: "keep" to preserve the worktree.`,
          error: "Could not verify worktree state",
        };
      }
      const { changedFiles, commits } = summary;
      if (changedFiles > 0 || commits > 0) {
        const parts: string[] = [];
        if (changedFiles > 0) {
          parts.push(
            `${changedFiles} uncommitted ${changedFiles === 1 ? "file" : "files"}`,
          );
        }
        if (commits > 0) {
          parts.push(
            `${commits} ${commits === 1 ? "commit" : "commits"} on ${session.worktreeBranch ?? "the worktree branch"}`,
          );
        }
        return {
          success: false,
          content: `Worktree has ${parts.join(" and ")}. Removing will discard this work permanently. Confirm with the user, then re-invoke with discard_changes: true — or use action: "keep" to preserve the worktree.`,
          error: "Worktree has uncommitted changes",
        };
      }
    }

    // Capture info before clearing session
    const { originalCwd, worktreePath, worktreeBranch } = session;

    if (action === "keep") {
      // Clear session state
      setCurrentWorktreeSession(null);

      // Restore CWD
      const aiManager = context.aiManager;
      if (aiManager) {
        aiManager.setWorkdir(originalCwd);
      }

      return {
        success: true,
        content: `Exited worktree. Your work is preserved at ${worktreePath}${worktreeBranch ? ` on branch ${worktreeBranch}` : ""}. Session is now back in ${originalCwd}.`,
      };
    }

    // action === "remove"
    const worktreeInfo = {
      name: session.worktreeName,
      path: worktreePath,
      branch: worktreeBranch,
      repoRoot: session.repoRoot,
      isNew: session.isNew,
    };

    // Count changes BEFORE removing the worktree (directory will be gone after)
    const summary = countWorktreeChanges(
      worktreePath,
      session.originalHeadCommit,
    ) ?? { changedFiles: 0, commits: 0 };

    removeWorktree(worktreeInfo);

    // Clear session state
    setCurrentWorktreeSession(null);

    // Restore CWD
    const aiManager = context.aiManager;
    if (aiManager) {
      aiManager.setWorkdir(originalCwd);
    }

    const discardParts: string[] = [];
    if (summary.commits > 0) {
      discardParts.push(
        `${summary.commits} ${summary.commits === 1 ? "commit" : "commits"}`,
      );
    }
    if (summary.changedFiles > 0) {
      discardParts.push(
        `${summary.changedFiles} uncommitted ${summary.changedFiles === 1 ? "file" : "files"}`,
      );
    }
    const discardNote =
      discardParts.length > 0
        ? ` Discarded ${discardParts.join(" and ")}.`
        : "";

    return {
      success: true,
      content: `Exited and removed worktree at ${worktreePath}.${discardNote} Session is now back in ${originalCwd}.`,
    };
  },
};
