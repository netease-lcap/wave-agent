# Feature Specification: Expand Plugin Capabilities

**Feature Branch**: `043-expand-plugin-capabilities`  
**Created**: 2026-01-13  
**Status**: Implemented  
**Input**: User description: "You’ve created a plugin with a slash command, but plugins can include much more: custom agents, Skills, hooks, MCP servers, and LSP servers.
Common mistake: Don’t put commands/, agents/, skills/, or hooks/ inside the .claude-plugin/ directory. Only plugin.json goes inside .claude-plugin/. All other directories must be at the plugin root level.
Directory	Location	Purpose
.claude-plugin/	Plugin root	Contains only plugin.json manifest (required)
commands/	Plugin root	Slash commands as Markdown files
agents/	Plugin root	Custom agent definitions
skills/	Plugin root	Agent Skills with SKILL.md files
hooks/	Plugin root	Event handlers in hooks.json
.mcp.json	Plugin root	MCP server configurations
.lsp.json	Plugin root	LSP server configurations for code intelligence
Next steps: Ready to add more features? Jump to Develop more complex plugins to add agents, hooks, MCP servers, and LSP servers. For complete technical specifications of all plugin components, see Plugins reference.
​
Develop more complex plugins
Once you’re comfortable with basic plugins, you can create more sophisticated extensions.
​
Add Skills to your plugin
Plugins can include Agent Skills to extend Agent’s capabilities. Skills are model-invoked: Agent automatically uses them based on the task context.
Add a skills/ directory at your plugin root with Skill folders containing SKILL.md files:
my-plugin/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── code-review/
        └── SKILL.md
Each SKILL.md needs frontmatter with name and description fields, followed by instructions:
---
name: code-review
description: Reviews code for best practices and potential issues. Use when reviewing code, checking PRs, or analyzing code quality.
---

When reviewing code, check for:
1. Code organization and structure
2. Error handling
3. Security concerns
4. Test coverage
After installing the plugin, restart Agent Code to load the Skills. For complete Skill authoring guidance including progressive disclosure and tool restrictions, see Agent Skills.
​
Add LSP servers to your plugin
For common languages like TypeScript, Python, and Rust, install the pre-built LSP plugins from the official marketplace. Create custom LSP plugins only when you need support for languages not already covered.
LSP (Language Server Protocol) plugins give Agent real-time code intelligence. If you need to support a language that doesn’t have an official LSP plugin, you can create your own by adding an .lsp.json file to your plugin:
.lsp.json
{
  "go": {
    "command": "gopls",
    "args": ["serve"],
    "extensionToLanguage": {
      ".go": "go"
    }
  }
}
Users installing your plugin must have the language server binary installed on their machine.
For complete LSP configuration options, see LSP servers.
​"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Adding Skills to a Plugin (Priority: P1)

A developer wants to extend Agent's capabilities by adding a Skill to their plugin. They create a `skills/` directory at the plugin root and a subdirectory for their skill containing a `SKILL.md` file with appropriate frontmatter and instructions.

**Why this priority**: Skills are a core way to extend Agent's behavior and provide specialized knowledge or tools.

**Independent Test**: Can be tested by creating a plugin with a `skills/` directory, adding a `SKILL.md` file, and verifying that Agent recognizes and can use the skill after a restart.

**Acceptance Scenarios**:

1. **Given** a plugin root directory, **When** a `skills/code-review/SKILL.md` file is added with valid frontmatter, **Then** the system should recognize the "code-review" skill.
2. **Given** a plugin with a skill, **When** Agent Code is restarted, **Then** the skill should be available for use by the model.

---

### User Story 2 - Adding LSP Servers to a Plugin (Priority: P2)

A developer wants to provide code intelligence for a language not supported by official plugins. They add an `.lsp.json` file to the plugin root with the necessary command and arguments to start a language server.

**Why this priority**: LSP support is crucial for providing a rich development experience (definitions, references, etc.) for custom or less common languages.

**Independent Test**: Can be tested by adding an `.lsp.json` file to a plugin and verifying that the specified language server is started when a file of the corresponding language is opened.

**Acceptance Scenarios**:

1. **Given** a plugin root directory, **When** an `.lsp.json` file is added with a configuration for "go", **Then** the system should use the specified command to start the language server for `.go` files.

---

### User Story 3 - Correct Plugin Structure Validation (Priority: P3)

A developer wants to ensure their plugin is correctly structured to avoid common mistakes. They want the system to warn them if they put component directories (like `skills/` or `commands/`) inside the `.claude-plugin/` directory.

**Why this priority**: Prevents common configuration errors and ensures plugins are loaded correctly.

**Independent Test**: Can be tested by creating a plugin with an incorrect structure and verifying that the system provides a warning or fails to load the misplaced components.

**Acceptance Scenarios**:

1. **Given** a plugin where `skills/` is inside `.claude-plugin/`, **When** the plugin is loaded, **Then** the system should ignore the `skills/` directory or provide a warning.
2. **Given** a plugin where `plugin.json` is the only file in `.claude-plugin/`, **When** the plugin is loaded, **Then** it should load successfully.

---

### Edge Cases

- What happens when a `SKILL.md` file has invalid frontmatter?
- How does the system handle multiple plugins defining the same skill name?
- What happens if the command specified in `.lsp.json` is not found on the user's machine?
- How does the system handle circular dependencies or conflicts between different plugin components?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support a `skills/` directory at the plugin root for Agent Skills.
- **FR-002**: System MUST support `SKILL.md` files within subdirectories of `skills/` for individual skill definitions.
- **FR-003**: System MUST parse frontmatter (name, description) from `SKILL.md` files.
- **FR-004**: System MUST support an `.lsp.json` file at the plugin root for LSP server configurations.
- **FR-005**: System MUST support an `.mcp.json` file at the plugin root for MCP server configurations.
- **FR-006**: System MUST support a `hooks/` directory at the plugin root with a `hooks.json` file for event handlers.
- **FR-007**: System MUST support an `agents/` directory at the plugin root for custom agent definitions.
- **FR-008**: System MUST support a `commands/` directory at the plugin root for slash commands as Markdown files.
- **FR-009**: System MUST enforce that only `plugin.json` is located inside the `.claude-plugin/` directory.
- **FR-010**: System MUST load these components when the plugin is installed or Agent Code is restarted.
- **FR-011**: System MUST ensure that tool definitions (e.g., `Skill`, `Task`) dynamically reflect components added by plugins without requiring a tool re-initialization.

### Key Entities *(include if feature involves data)*

- **Plugin**: The root container for all plugin components.
- **Skill**: A model-invoked capability defined by a `SKILL.md` file.
- **LSP Server**: A configuration for language intelligence defined in `.lsp.json`.
- **MCP Server**: A configuration for Model Context Protocol servers defined in `.mcp.json`.
- **Hook**: An event handler defined in `hooks.json`.
- **Agent**: A custom agent definition.
- **Command**: A slash command defined as a Markdown file.
