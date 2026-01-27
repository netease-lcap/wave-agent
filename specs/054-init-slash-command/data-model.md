# Data Model: Init Slash Command

## Entities

### AGENTS.md
- **Description**: A markdown file in the repository root that provides guidance to AI agents.
- **Attributes**:
  - `content`: The full text of the guidance.
  - `prefix`: A mandatory header section.
  - `commands`: Common development commands (build, test, lint).
  - `architecture`: High-level code structure description.
  - `rules`: Important parts of existing rule files (.cursorrules, etc.).

### SlashCommand
- **Description**: Represents the `/init` command in the system.
- **Attributes**:
  - `id`: "init"
  - `name`: "init"
  - `description`: "Initialize repository for AI agents by generating AGENTS.md"

## State Transitions
- **None**: The command is stateless and idempotent (it can be run multiple times to update the file).
