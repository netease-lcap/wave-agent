# Feature Specification: Local Plugin Support

**Feature Branch**: `042-local-plugin-support`  
**Created**: 2026-01-13  
**Status**: Implemented  
**Input**: User description: "1, sdk support plugins: [ { type: \"local\", path: \"./my-plugin\" }, { type: \"local\", path: \"/absolute/path/to/another-plugin\" } ]. 2, code support Create your first plugin ... but .claude-plugin dir should be renamed to .wave-plugin"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer creates a local plugin (Priority: P1)

As a developer, I want to create a custom plugin locally so that I can extend the agent's capabilities with my own commands.

**Why this priority**: This is the core functionality that enables the plugin ecosystem. Without the ability to create and define a plugin, no other features can work.

**Independent Test**: Can be tested by creating a directory with a valid `.wave-plugin/plugin.json` and a command in `commands/`, then verifying the agent recognizes it.

**Acceptance Scenarios**:

1. **Given** a new directory `my-first-plugin`, **When** I create `.wave-plugin/plugin.json` with valid metadata, **Then** the directory is recognized as a valid plugin structure.
2. **Given** a plugin directory, **When** I add a Markdown file to the `commands/` directory, **Then** it is recognized as a potential slash command.

---

### User Story 2 - User loads a local plugin via CLI (Priority: P1)

As a user, I want to load a local plugin when starting the CLI so that I can use its custom commands immediately.

**Why this priority**: This is the primary way users will interact with local plugins during development and testing.

**Independent Test**: Can be tested by running the CLI with the `--plugin-dir` flag pointing to a valid plugin directory and checking if the plugin is loaded.

**Acceptance Scenarios**:

1. **Given** a valid plugin at `./my-plugin`, **When** I run `wave --plugin-dir ./my-plugin`, **Then** the plugin is loaded into the session.
2. **Given** an invalid plugin path, **When** I run `wave --plugin-dir ./invalid-path`, **Then** the system should report an error or warning and continue without the plugin.

---

### User Story 3 - User executes a plugin command (Priority: P1)

As a user, I want to run a command defined in a plugin so that I can get the specific functionality provided by that plugin.

**Why this priority**: This is the ultimate goal of the plugin system - executing custom logic.

**Independent Test**: Can be tested by typing a namespaced slash command (e.g., `/my-plugin:hello`) in the CLI and verifying the agent responds according to the command's definition.

**Acceptance Scenarios**:

1. **Given** a loaded plugin named `my-plugin` with a command `hello`, **When** I type `/my-plugin:hello`, **Then** the agent executes the command and provides the defined response.
2. **Given** multiple loaded plugins, **When** I use the namespaced command, **Then** the correct plugin's command is executed.

---

### Edge Cases

- **Invalid Manifest**: What happens when `plugin.json` is missing required fields like `name`? The system should fail gracefully and inform the user.
- **Path Resolution**: How does the system handle relative paths vs absolute paths in the SDK configuration? Both should be supported and resolved correctly relative to the configuration file or current working directory.
- **Command Collisions**: What happens if two plugins have the same name? The system should probably warn the user or use a deterministic loading order (e.g., last one wins or first one wins).
- **Malformed Markdown**: How does the system handle a command Markdown file with invalid YAML frontmatter? It should skip the command and log an error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: SDK MUST support a `plugins` configuration option that accepts an array of local plugin definitions (type "local" and path).
- **FR-002**: CLI MUST support a `--plugin-dir` flag to load a plugin from a specific directory.
- **FR-003**: System MUST recognize `.wave-plugin/plugin.json` as the plugin manifest file.
- **FR-004**: Plugin manifest MUST include `name`, `description`, and `version`. `author` is optional.
- **FR-005**: System MUST load slash commands from the `commands/` directory within the plugin folder.
- **FR-006**: Slash commands MUST be defined in Markdown files with a YAML frontmatter for the `description`.
- **FR-007**: Slash commands MUST be namespaced using the plugin name and a colon (e.g., `/plugin-name:command-name`).
- **FR-008**: System MUST support both relative and absolute paths for local plugins in both SDK and CLI.
- **FR-009**: The plugin name in the manifest MUST be used as the namespace for its slash commands.

### Key Entities *(include if feature involves data)*

- **Plugin**: A self-contained directory containing metadata and functionality extensions.
- **Plugin Manifest**: A JSON file (`.wave-plugin/plugin.json`) containing the plugin's identity and metadata.
- **Slash Command**: A custom interaction defined in a Markdown file that the agent can execute.
