/**
 * Worktree hooks — replace semantics (aligned with Claude Code).
 *
 * When `WorktreeCreate` / `WorktreeRemove` hooks are configured, wave delegates
 * worktree creation/removal to the hooks instead of running git itself:
 * - `WorktreeCreate`: the first successful hook's stdout (trimmed) is the
 *   worktree path. All failures / empty output block creation.
 * - `WorktreeRemove`: only fires for hook-based worktrees; wave never runs
 *   `git worktree remove` for them. Failures are logged, never blocking.
 *
 * Unlike HookManager (DI-bound, per-agent), this module operates on a merged
 * `PartialHookConfiguration` so it can be used from standalone CLI paths
 * (packages/code) that load settings via `loadMergedWaveConfig`.
 * See docs/specs/multi-agent/worktree.md.
 */

import type {
  ExtendedHookExecutionContext,
  HookEventConfig,
  HookExecutionResult,
  PartialHookConfiguration,
} from "../types/hooks.js";
import { executeCommand } from "./hook.js";
import { logger } from "../utils/globalLogger.js";

/** Minimal context required to run worktree hooks standalone. */
export interface WorktreeHookContext {
  /** Absolute project directory (also the hook cwd / $WAVE_PROJECT_DIR) */
  projectDir: string;
  sessionId?: string;
  transcriptPath?: string;
  /** Additional environment variables for the hook process */
  env?: Record<string, string>;
}

export function hasWorktreeCreateHook(
  configuration: PartialHookConfiguration | undefined,
): boolean {
  return hasWorktreeHook(configuration, "WorktreeCreate");
}

export function hasWorktreeRemoveHook(
  configuration: PartialHookConfiguration | undefined,
): boolean {
  return hasWorktreeHook(configuration, "WorktreeRemove");
}

function hasWorktreeHook(
  configuration: PartialHookConfiguration | undefined,
  event: "WorktreeCreate" | "WorktreeRemove",
): boolean {
  return (
    configuration?.[event]?.some((config) => config.hooks.length > 0) ?? false
  );
}

/**
 * Execute WorktreeCreate hooks and return the worktree path from hook stdout.
 *
 * The first successful hook (exit code 0) with non-empty stdout provides the
 * worktree path (trimmed). Throws if every hook fails or none emits output —
 * creation is blocked.
 *
 * Callers should check hasWorktreeCreateHook() before calling.
 */
export async function executeWorktreeCreateHook(
  name: string,
  configuration: PartialHookConfiguration | undefined,
  context: WorktreeHookContext,
): Promise<{ worktreePath: string }> {
  const hookConfigs = configuration?.["WorktreeCreate"] ?? [];
  const results = await runWorktreeHooks(
    "WorktreeCreate",
    hookConfigs,
    context,
    { name },
  );

  const successful = results.find(
    (r) => r.success && (r.stdout ?? "").trim().length > 0,
  );

  if (!successful) {
    const failedOutputs = results
      .filter((r) => !r.success)
      .map((r) => `${r.command}: ${r.stderr || r.stdout || "no output"}`);
    throw new Error(
      `WorktreeCreate hook failed: ${failedOutputs.join("; ") || "no successful output"}`,
    );
  }

  return { worktreePath: successful.stdout!.trim() };
}

/**
 * Execute WorktreeRemove hooks for a hook-based worktree.
 * Returns true if hooks ran, false if none were configured.
 * Failures are logged but never throw (non-blocking, aligned with Claude Code).
 */
export async function executeWorktreeRemoveHook(
  worktreePath: string,
  configuration: PartialHookConfiguration | undefined,
  context: WorktreeHookContext,
): Promise<boolean> {
  const hookConfigs = configuration?.["WorktreeRemove"] ?? [];
  if (hookConfigs.length === 0) {
    return false;
  }

  const results = await runWorktreeHooks(
    "WorktreeRemove",
    hookConfigs,
    context,
    { worktreePath },
  );

  for (const result of results) {
    if (!result.success) {
      logger?.error(
        `WorktreeRemove hook failed [${result.command}]: ${result.stderr || "no output"}`,
      );
    }
  }

  return true;
}

/**
 * Run every configured hook command for a worktree event, mirroring
 * HookManager.executeHooks' per-command handling: `${WAVE_PLUGIN_ROOT}` /
 * `${CLAUDE_PLUGIN_ROOT}` substitution, plugin env injection, per-command
 * timeout, and fire-and-forget async hooks. Results are tagged with the
 * command for error messages.
 */
async function runWorktreeHooks(
  event: "WorktreeCreate" | "WorktreeRemove",
  eventConfigs: HookEventConfig[],
  context: WorktreeHookContext,
  extra: { name?: string; worktreePath?: string },
): Promise<HookExecutionResult[]> {
  const baseContext: ExtendedHookExecutionContext = {
    event,
    projectDir: context.projectDir,
    timestamp: new Date(),
    sessionId: context.sessionId,
    transcriptPath: context.transcriptPath,
    cwd: context.projectDir,
    env: context.env,
    ...extra,
  };

  const results: HookExecutionResult[] = [];

  for (const config of eventConfigs) {
    for (const hookCommand of config.hooks) {
      const options = hookCommand.timeout
        ? { timeout: hookCommand.timeout * 1000 }
        : undefined;

      // Build execution context with WAVE_PLUGIN_ROOT if this is a plugin hook
      let command = hookCommand.command;
      const execContext: ExtendedHookExecutionContext = hookCommand.pluginRoot
        ? {
            ...baseContext,
            env: {
              ...(baseContext.env ?? {}),
              WAVE_PLUGIN_ROOT: hookCommand.pluginRoot,
              CLAUDE_PLUGIN_ROOT: hookCommand.pluginRoot,
            },
          }
        : baseContext;

      if (hookCommand.pluginRoot) {
        command = command.replace(
          /\$\{WAVE_PLUGIN_ROOT\}/g,
          hookCommand.pluginRoot,
        );
        command = command.replace(
          /\$\{CLAUDE_PLUGIN_ROOT\}/g,
          hookCommand.pluginRoot,
        );
      }

      if (hookCommand.async) {
        // Async hooks are fire-and-forget (never block, never contribute a
        // path for WorktreeCreate).
        executeCommand(command, execContext, options).catch((error) => {
          const message =
            error instanceof Error ? error.message : "Unknown execution error";
          logger?.error(
            `[worktreeHooks] Async ${event} hook failed: ${message}`,
          );
        });
        continue;
      }

      try {
        const result = await executeCommand(command, execContext, options);
        results.push({ ...result, command });
      } catch (error) {
        // Rare — executeCommand resolves rather than rejects on failure.
        const message =
          error instanceof Error ? error.message : "Unknown execution error";
        results.push({
          success: false,
          stderr: message,
          duration: 0,
          timedOut: false,
          command,
        });
      }
    }
  }

  return results;
}
