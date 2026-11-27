/**
 * 子代理嵌套委派的深度上限（spec multi-agent/subagent「子代理嵌套委派」）。
 *
 * 语义与 Claude Code 的 `AI()` 一致：主代理是深度 0，上限是「允许到达的最大
 * 深度」，默认 3。到顶的代理**拿不到 `Agent` 工具**——不是调用后被权限拒绝，
 * 而是工具清单里就没有它，模型不会发出一个注定失败的调用。
 *
 * 插件 `$.agent.spawn` 那条路不读这个上限：它锁在深度 1（容器槽
 * `ModAgentDepth`），属插件边界，见 spec `ecosystem/plugin-mods`。
 */
import { loadMergedWaveConfig } from "../services/configurationService.js";

/** 环境变量：最大委派深度。 */
export const SUBAGENT_DEPTH_ENV_VAR = "WAVE_MAX_SUBAGENT_SPAWN_DEPTH";

/** 代码默认值，与 Claude Code 的 `AI()` 默认值一致。 */
export const DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH = 3;

/**
 * 只接受正整数；其余（含 `0`、负数、小数、非数字）一律视为没配。
 */
export function parseMaxSubagentSpawnDepth(
  raw: string | number | undefined,
): number | undefined {
  if (raw === undefined) return undefined;
  const value = typeof raw === "number" ? raw : Number(raw.trim());
  if (raw === "" || !Number.isInteger(value) || value < 1) return undefined;
  return value;
}

/**
 * 深度上限。解析顺序与其它 `WAVE_*` 一致：merged settings.json 的 `env` 段
 * （会话快照，压过进程环境变量）→ `process.env` → 默认 3。
 *
 * 配了非法值时退回默认、不抛不阻塞——这个函数跑在每次工具注册表重建上，
 * 包括无关的 settings 编辑触发的热重载。
 *
 * `sessionWorkdir` 是「会话起点」那个目录（容器槽 `SessionWorkdir`），不是会随
 * `cd` 变的 `CurrentWorkdir`：项目级配置不该因为会话里 `cd` 过一次就换文件。
 */
export function getMaxSubagentSpawnDepth(sessionWorkdir?: string): number {
  let fromSettings: string | undefined;
  if (sessionWorkdir) {
    try {
      fromSettings =
        loadMergedWaveConfig(sessionWorkdir)?.env?.[SUBAGENT_DEPTH_ENV_VAR];
    } catch {
      // 落到进程环境变量与默认值。
    }
  }
  return (
    parseMaxSubagentSpawnDepth(fromSettings) ??
    parseMaxSubagentSpawnDepth(process.env[SUBAGENT_DEPTH_ENV_VAR]) ??
    DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH
  );
}
