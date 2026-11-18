/**
 * Policy for plugins that ship inside the SDK (`<name>@builtin`).
 *
 * The merged `enabledPlugins` always wins; `defaultEnabled` only decides what
 * happens when no entry names the plugin at all. Absent means off — the right
 * default for a plugin whose hooks fire in every session of every project the
 * enabling scope covers (see the `sdd` spec,「按需启用内置插件」).
 */
export interface BuiltinPluginPolicy {
  /** Load without an `enabledPlugins` entry. Defaults to `false`. */
  defaultEnabled?: boolean;
}

export const BUILTIN_PLUGIN_POLICIES: Record<string, BuiltinPluginPolicy> = {
  // Spec-first workflow is a per-project decision: its SessionStart hook would
  // otherwise inject guidance into every repository. Declared here so the value
  // lives beside the plugin rather than hard-coded in the loader.
  sdd: { defaultEnabled: false },
};

export function getBuiltinPluginPolicy(name: string): BuiltinPluginPolicy {
  return BUILTIN_PLUGIN_POLICIES[name] ?? {};
}

/**
 * Whether `<name>@builtin` should load.
 *
 * An explicit `enabledPlugins` entry wins either way — `true` loads, `false`
 * suppresses even a `defaultEnabled: true` plugin. A non-boolean entry keeps the
 * loader's previous strictness and counts as off.
 */
export function isBuiltinPluginEnabled(
  name: string,
  enabledPlugins: Record<string, boolean>,
  policy: BuiltinPluginPolicy = getBuiltinPluginPolicy(name),
): boolean {
  const explicit = enabledPlugins[`${name}@builtin`];
  if (explicit !== undefined) return explicit === true;
  return policy.defaultEnabled === true;
}
