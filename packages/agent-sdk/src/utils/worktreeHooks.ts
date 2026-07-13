import { executeCommand } from "../services/hook.js";
import { loadMergedWaveConfig } from "../services/configurationService.js";
import type {
  ExtendedHookExecutionContext,
  HookExecutionResult,
} from "../types/hooks.js";
import { logger } from "./globalLogger.js";

type WorktreeHookEvent = "WorktreeCreate" | "WorktreeRemove";

export function extractWorktreePath(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed?.hookSpecificOutput?.worktreePath) {
      return String(parsed.hookSpecificOutput.worktreePath);
    }
    if (parsed?.worktreePath) {
      return String(parsed.worktreePath);
    }
  } catch {
    // Not JSON — fall through to path detection
  }

  if (trimmed.startsWith("/")) {
    return trimmed.split("\n")[0].trim();
  }

  return null;
}

export function hasWorktreeHook(
  workdir: string,
  event: WorktreeHookEvent,
): boolean {
  const config = loadMergedWaveConfig(workdir);
  return (config?.hooks?.[event]?.length ?? 0) > 0;
}

async function executeWorktreeHooksDirect(
  event: WorktreeHookEvent,
  mainRepoDir: string,
  fields: Partial<
    Pick<
      ExtendedHookExecutionContext,
      "worktreeName" | "worktreePath" | "mainRepoDir"
    >
  >,
): Promise<{ results: HookExecutionResult[]; allStdout: string } | null> {
  const config = loadMergedWaveConfig(mainRepoDir);
  const hookConfigs = config?.hooks?.[event];
  if (!hookConfigs || hookConfigs.length === 0) return null;

  const context: ExtendedHookExecutionContext = {
    event,
    projectDir: mainRepoDir,
    timestamp: new Date(),
    sessionId: "",
    cwd: mainRepoDir,
    ...fields,
    env: Object.fromEntries(
      Object.entries(process.env).filter((e) => e[1] !== undefined),
    ) as Record<string, string>,
  };

  const results: HookExecutionResult[] = [];
  let allStdout = "";

  for (const hookConfig of hookConfigs) {
    for (const hook of hookConfig.hooks) {
      const result = await executeCommand(hook.command, context);
      results.push(result);
      if (result.stdout) {
        allStdout += result.stdout + "\n";
      }
    }
  }

  return { results, allStdout };
}

export async function executeWorktreeCreateHookDirect(
  name: string,
  mainRepoDir: string,
): Promise<string | null> {
  const output = await executeWorktreeHooksDirect(
    "WorktreeCreate",
    mainRepoDir,
    { worktreeName: name, mainRepoDir },
  );
  if (!output) return null;

  for (const r of output.results) {
    if (!r.success) {
      throw new Error(
        `WorktreeCreate hook failed (exit code ${r.exitCode}): ${r.stderr || r.stdout}`,
      );
    }
  }

  const worktreePath = extractWorktreePath(output.allStdout);
  if (!worktreePath) {
    throw new Error(
      `WorktreeCreate hook did not output a valid worktree path. stdout: ${output.allStdout}`,
    );
  }

  return worktreePath;
}

export async function executeWorktreeRemoveHookDirect(
  worktreePath: string,
  mainRepoDir: string,
): Promise<boolean> {
  const output = await executeWorktreeHooksDirect(
    "WorktreeRemove",
    mainRepoDir,
    { worktreePath },
  );
  if (!output) return false;

  for (const r of output.results) {
    if (!r.success) {
      logger?.warn(
        `WorktreeRemove hook failed (exit code ${r.exitCode}): ${r.stderr || r.stdout}`,
      );
    }
  }

  return true;
}
