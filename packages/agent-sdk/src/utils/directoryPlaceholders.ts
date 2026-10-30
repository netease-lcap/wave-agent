/**
 * Directory placeholders a skill or a slash command may write, and the one
 * implementation that resolves them.
 *
 * Three carriers, all resolved against the same values:
 * - a skill's **body**, rendered for the model at invocation time;
 * - a skill's frontmatter **`allowed-tools`** rules, which a skill uses to
 *   pre-authorize its own scripts (`Bash(node ${WAVE_SKILL_DIR}/scripts/x.mjs*)`);
 * - a **plugin command's** body and `allowed-tools` rules — plugin root tokens
 *   only, because a command has no skill directory of its own.
 *
 * A rule that keeps a literal placeholder is worse than a missing one: the
 * permission system never reports anything, the rule just never matches, and the
 * author sees unexplained confirmation prompts. So rules are resolved to real
 * paths before they are registered (spec `ecosystem/agent-skills` 场景 4 and
 * `commands/slash-commands`「插件命令正文可用插件根占位符」), and a placeholder
 * that cannot be resolved is reported instead of being left to fail silently
 * (同规格场景 5).
 */

/** Tokens pointing at the skill's own directory. Only skills have one. */
const SKILL_DIR_TOKENS = ["${WAVE_SKILL_DIR}", "${CLAUDE_SKILL_DIR}"];

/** Tokens pointing at the enclosing plugin's root. Only plugin content has one. */
const PLUGIN_ROOT_TOKENS = ["${WAVE_PLUGIN_ROOT}", "${CLAUDE_PLUGIN_ROOT}"];

export interface DirectoryPlaceholderContext {
  /** The directory whose text is being resolved (a skill's folder). */
  skillPath?: string;
  /** The plugin root, when the text comes from a plugin. */
  pluginRoot?: string;
}

/**
 * Replace every directory placeholder in `text` with its real path. Tokens with
 * no source to point at are left in place — callers report that with
 * {@link findUnresolvedDirectoryPlaceholders} rather than guessing a value.
 */
export function substituteDirectoryPlaceholders(
  text: string,
  context: DirectoryPlaceholderContext,
): string {
  let result = text;
  if (context.skillPath) {
    for (const token of SKILL_DIR_TOKENS) {
      result = result.split(token).join(context.skillPath);
    }
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
export function findUnresolvedDirectoryPlaceholders(text: string): string[] {
  return [...SKILL_DIR_TOKENS, ...PLUGIN_ROOT_TOKENS].filter((token) =>
    text.includes(token),
  );
}
