/**
 * Directory placeholders a skill may write, and the one implementation that
 * resolves them.
 *
 * Two places in a SKILL.md can carry them, and both must be resolved against
 * the same values:
 * - the **body**, rendered for the model at invocation time;
 * - the frontmatter's **`allowed-tools`** rules, which a skill uses to
 *   pre-authorize its own scripts (`Bash(node ${WAVE_SKILL_DIR}/scripts/x.mjs*)`).
 *
 * A rule that keeps a literal placeholder is worse than a missing one: the
 * permission system never reports anything, the rule just never matches, and
 * the author sees unexplained confirmation prompts. So rules are resolved to
 * real paths before they are registered (spec `ecosystem/agent-skills` 场景 4),
 * and a placeholder that cannot be resolved is reported instead of being left
 * to fail silently (同规格 场景 5).
 */

/** Tokens pointing at the skill's own directory. Always resolvable. */
const SKILL_DIR_TOKENS = ["${WAVE_SKILL_DIR}", "${CLAUDE_SKILL_DIR}"];

/** Tokens pointing at the enclosing plugin's root. Only plugin skills have one. */
const PLUGIN_ROOT_TOKENS = ["${WAVE_PLUGIN_ROOT}", "${CLAUDE_PLUGIN_ROOT}"];

export interface SkillPlaceholderContext {
  /** The skill directory (the folder holding SKILL.md). */
  skillPath: string;
  /** The plugin root, when the skill comes from a plugin. */
  pluginRoot?: string;
}

/**
 * Replace every skill directory placeholder in `text` with its real path.
 * Plugin-root tokens are left in place when there is no plugin root to point
 * at — callers report that with {@link findUnresolvedSkillPlaceholders} rather
 * than guessing a value.
 */
export function substituteSkillPlaceholders(
  text: string,
  context: SkillPlaceholderContext,
): string {
  let result = text;
  for (const token of SKILL_DIR_TOKENS) {
    result = result.split(token).join(context.skillPath);
  }
  if (context.pluginRoot) {
    for (const token of PLUGIN_ROOT_TOKENS) {
      result = result.split(token).join(context.pluginRoot);
    }
  }
  return result;
}

/**
 * The known placeholders still present in `text` after substitution — an
 * author error the caller must report, never a value to leave in a rule.
 */
export function findUnresolvedSkillPlaceholders(text: string): string[] {
  return [...SKILL_DIR_TOKENS, ...PLUGIN_ROOT_TOKENS].filter((token) =>
    text.includes(token),
  );
}
