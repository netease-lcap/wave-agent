/**
 * Deferred tool loading availability.
 *
 * Deferred loading is ON by default, but only steps in when there is something
 * to save: below the threshold every tool is declared individually and the
 * request `tools` array is byte-identical to the pre-deferral list, so sessions
 * with neither MCP servers nor defer-annotated built-in tools are untouched
 * (see `docs/specs/core/tool-deferred-loading.md`, 「阈值门控与默认生效」).
 *
 * An explicit `enableDeferredTools` in settings.json overrides the threshold in
 * both directions; the count is the number of deferrable tools in the current
 * pool (MCP tools + built-ins annotated `defer`).
 */
import { loadMergedWaveConfig } from "./configurationService.js";
import { CATALOG_DEFAULT_BUDGET_TOKENS } from "../utils/toolCatalog.js";

/** Deferrable tool count from which an unset `enableDeferredTools` turns on. */
export const DEFERRED_TOOLS_MIN_DEFERRABLE_TOOLS = 5;

export interface DeferredToolsSettings {
  /** Explicit setting; `undefined` = let the threshold decide. */
  enabled?: boolean;
  /** Resident catalog budget in tokens. */
  tokenBudget: number;
}

/**
 * Read the deferred-loading settings. Only local merged settings are consulted
 * — remote managed settings do not carry a switch for this feature.
 */
export function readDeferredToolsSettings(
  workdir?: string,
): DeferredToolsSettings {
  const config = workdir ? loadMergedWaveConfig(workdir) : null;
  const budget = config?.deferredToolsTokenBudget;
  return {
    enabled: config?.enableDeferredTools,
    tokenBudget:
      typeof budget === "number" && Number.isFinite(budget) && budget > 0
        ? budget
        : CATALOG_DEFAULT_BUDGET_TOKENS,
  };
}

/**
 * Whether deferred loading applies to a pool with `deferrableToolCount`
 * deferrable tools.
 */
export function isDeferredToolsEnabled(
  deferrableToolCount: number,
  settings: DeferredToolsSettings,
): boolean {
  if (settings.enabled !== undefined) return settings.enabled;
  return deferrableToolCount >= DEFERRED_TOOLS_MIN_DEFERRABLE_TOOLS;
}
