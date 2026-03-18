# Data Model: Builtin Settings Skill

## WaveConfiguration (Existing)
The root configuration structure for all Wave Agent settings.

| Field | Type | Description |
|-------|------|-------------|
| `hooks` | `Partial<Record<HookEvent, HookEventConfig[]>>` | Configure automation hooks. |
| `env` | `Record<string, string>` | Environment variables key-value pairs. |
| `permissions` | `object` | Manage tool permissions. |
| `enabledPlugins` | `Record<string, boolean>` | Enable or disable plugins. |
| `language` | `string` | Preferred language for agent communication. |
| `autoMemoryEnabled` | `boolean` | Whether auto-memory is enabled. |

## SkillMetadata (Updated)
Metadata for a skill, including its type.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique name of the skill. |
| `description` | `string` | Brief description of the skill. |
| `type` | `"personal" \| "project" \| "builtin"` | The scope of the skill. |
| `skillPath` | `string` | Absolute path to the skill directory. |
| `allowedTools` | `string[]` | List of tools the skill is allowed to use. |

## SkillCollection (Updated)
A collection of skills from a specific scope.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"personal" \| "project" \| "builtin"` | The scope of the collection. |
| `basePath` | `string` | Base directory for the collection. |
| `skills` | `Map<string, SkillMetadata>` | Map of skill names to metadata. |
| `errors` | `SkillError[]` | List of discovery errors. |
