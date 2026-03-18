# Research: Builtin Settings Skill

## Decision: Builtin Skill Discovery
**Rationale**: To support "builtin" skills that are part of the Wave Agent SDK, we need a dedicated directory and a mechanism in `SkillManager` to discover them.
**Chosen Approach**: 
- Create `packages/agent-sdk/src/builtin-skills` directory.
- Update `SkillManager` to include a `builtin` collection type.
- Add `getBuiltinSkillsDir()` to `packages/agent-sdk/src/utils/configPaths.ts`.
- Update `SkillManager.initialize()` to discover skills from the builtin directory.

## Decision: Settings Skill Implementation
**Rationale**: The `settings` skill should provide guidance and help users manage their `settings.json` files.
**Chosen Approach**:
- Implement `settings` skill as a markdown file: `packages/agent-sdk/src/builtin-skills/settings/SKILL.md`.
- The skill will use `Bash`, `Read`, and `Write` tools to help users view and update settings.
- It will contain detailed instructions for the agent on how to guide the user through configuration.

## Decision: Complex Hooks Documentation
**Rationale**: Hooks can be complex, and detailed documentation should be kept separate to maintain clarity in the main skill guide.
**Chosen Approach**:
- Create `packages/agent-sdk/src/builtin-skills/settings/HOOKS.md`.
- Link to `HOOKS.md` from `SKILL.md`.
- Use `${WAVE_SKILL_DIR}` placeholder in `SKILL.md` to correctly link to `HOOKS.md` regardless of where the skill is installed.

## Alternatives Considered
- **Programmatic Skill Registration**: Registering the skill in code instead of a markdown file. Rejected because it's less flexible and doesn't follow the existing skill pattern.
- **Plugin-based Settings Skill**: Implementing the skill as a plugin. Rejected because settings management is a core feature that should be available without plugins.
