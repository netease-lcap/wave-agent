/**
 * 插件变更提示的逐字文案（docs/specs/ecosystem/plugin.md「插件变更提示」）。
 * 宿主端共用以免文案漂移（JetBrains 侧是逐字一致的 Kotlin 常量副本）；两条都是
 * 中性提示，不占成功 / 失败语义色。
 *
 * 放在 `constants/` 而非 pluginManager：宿主只需要这两行文案，插件重载本身跑在
 * CLI 子进程里（宿主不加载 `PluginManager`）。从 SDK 桶入口取文案会把整个 agent
 * 运行时——连同会在模块求值期抛错的依赖——一起打进宿主 bundle。
 */
export const PLUGIN_CHANGE_PENDING_MESSAGE =
  "插件已变更。运行 /reload-plugins 使其生效。";
export const PLUGIN_RELOADED_MESSAGE = "插件已重载。";
