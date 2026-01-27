# Data Model: Modular Rules

## Entities

### Rule
Represents a single modular rule loaded from a Markdown file.

- **id**: `string` (Unique identifier, usually the file path relative to rules root)
- **name**: `string` (Derived from the first H1 in the Markdown file or filename)
- **content**: `string` (The Markdown content of the rule, excluding frontmatter)
- **paths**: `string[]` (Optional list of glob patterns from YAML frontmatter)
- **source**: `'project' | 'user'` (Whether it's a project-level or user-level rule)
- **filePath**: `string` (Absolute path to the source file)

### RuleRegistry
The internal state managing all discovered and active rules.

- **allRules**: `Rule[]` (List of all discovered rules)
- **activeRules**: `Rule[]` (List of rules currently active based on the task context)

## State Transitions

1. **Discovery**: On agent initialization, `RuleManager` scans `.wave/rules/` and `~/.wave/rules/`.
2. **Loading**: Files are read, frontmatter parsed, and `Rule` objects created.
3. **Activation**: Before each AI call, `RuleManager` filters `allRules` against the files currently in the `MessageManager` context.
4. **Injection**: Active rules are formatted and appended to the system prompt.

## Validation Rules
- **Circular Symlinks**: Discovery must stop and log a warning if a circular symlink is detected.
- **Invalid YAML**: If frontmatter is malformed, the rule should be loaded without path scoping (unconditional) and a warning logged.
- **Duplicate IDs**: If two rules have the same ID (e.g., same relative path in project and user rules), project rules take priority.
