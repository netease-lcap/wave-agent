/**
 * Workflow run size thresholds, shared with the UI entries.
 *
 * Dependency-free on purpose: the webview (a browser bundle) imports this module
 * through `wave-agent-sdk/constants`, so nothing here may reach for the agent
 * runtime (see the entry's own note in `constants/index.ts`).
 *
 * Above either threshold a run is marked oversized in the workflow UI — the
 * `/workflows` list row and detail (spec「预算与规模硬上限」场景 7). Values are
 * Claude Code's 2.1.293 defaults, read out of its binary as the fallbacks of
 * `CLAUDE_CODE_WORKFLOW_SIZE_WARNING_AGENTS` (25) and
 * `CLAUDE_CODE_WORKFLOW_SIZE_WARNING_TOKENS` (1_500_000); Claude Code surfaces
 * the same thresholds as a marker in its workflow list (`Large workflow ·
 * /workflows to stop`) and never tells the model.
 *
 * Wave does the same, and that is the point: the marker is the human's cue to
 * stop a run. It used to be a notification injected into the model's context
 * instead, which turned "this run is big" into "ask the user whether to keep
 * going" on every multi-phase research run — those are ~58 agents, so they
 * always crossed. Nobody could ever let one finish; see the spec's 2026-10-16
 * 口径变更.
 */
export const WORKFLOW_SIZE_WARNING_AGENTS = 25;
export const WORKFLOW_SIZE_WARNING_TOKENS = 1_500_000;

/** 覆盖 {@link WORKFLOW_SIZE_WARNING_AGENTS} 的环境变量（`settings.json` 的 `env` 也算）。 */
export const WORKFLOW_SIZE_WARNING_AGENTS_ENV =
  "WAVE_WORKFLOW_SIZE_WARNING_AGENTS";
/** 覆盖 {@link WORKFLOW_SIZE_WARNING_TOKENS} 的环境变量。 */
export const WORKFLOW_SIZE_WARNING_TOKENS_ENV =
  "WAVE_WORKFLOW_SIZE_WARNING_TOKENS";

/** 一次判定实际用的两个阈值（环境变量生效之后的值）。 */
export interface WorkflowSizeLimits {
  agents: number;
  tokens: number;
}

/**
 * 只认正的有限数：`0`、空串、`"abc"` 一律当作没设，回退到默认值。
 *
 * 与 Claude Code 的 `_Y()` 同口径 —— 那边同样把 `0` 当无效，因为「阈值设成
 * 0」会让每个运行一启动就报警，几乎不可能是本意。
 */
function positiveNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * 本次生效的规模预警阈值。
 *
 * 判定（`isWorkflowRunOversized`）与界面文案（`/workflows` 里那句「越过阈值
 * N agents / M tokens」）都读这个函数，所以显示的永远是**生效值**：写死常量
 * 会让设了环境变量的用户看到一个自己没生效的数字。
 */
export function resolveWorkflowSizeLimits(
  env?: Record<string, string | undefined>,
): WorkflowSizeLimits {
  return {
    agents:
      positiveNumber(env?.[WORKFLOW_SIZE_WARNING_AGENTS_ENV]) ??
      WORKFLOW_SIZE_WARNING_AGENTS,
    tokens:
      positiveNumber(env?.[WORKFLOW_SIZE_WARNING_TOKENS_ENV]) ??
      WORKFLOW_SIZE_WARNING_TOKENS,
  };
}
