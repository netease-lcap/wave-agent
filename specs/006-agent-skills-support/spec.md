# Feature Specification: Agent Skills Support

**Feature Branch**: `006-agent-skills-support`  
**Created**: 2024-12-19  
**Status**: Implemented  
**Input**: User description: "support Skill. What are Agent Skills? Agent Skills package expertise into discoverable capabilities. Each Skill consists of a SKILL.md file with instructions that Claude reads when relevant, plus optional supporting files like scripts and templates. How Skills are invoked: Skills are model-invoked—Claude autonomously decides when to use them based on your request and the Skill's description. This is different from slash commands, which are user-invoked (you explicitly type /command to trigger them). Create a Skill Skills are stored as directories containing a SKILL.md file. Personal Skills Personal Skills are available across all your projects. Store them in ~/.claude/skills/: Use personal Skills for: Your individual workflows and preferences Experimental Skills you're developing Personal productivity tools Project Skills Project Skills are shared with your team. Store them in .claude/skills/ within your project: Use project Skills for: Team workflows and conventions Project-specific expertise Shared utilities and scripts Project Skills are checked into git and automatically available to team members. remember replace .claude with .wave . Write SKILL.md Create a SKILL.md file with YAML frontmatter and Markdown content: Field requirements: name: Must use lowercase letters, numbers, and hyphens only (max 64 characters) description: Brief description of what the Skill does and when to use it (max 1024 characters) The description field is critical for Claude to discover when to use your Skill. It should include both what the Skill does and when Claude should use it. Claude to Wave. Add supporting files Create additional files alongside SKILL.md: Reference these files from SKILL.md: Claude reads these files only when needed, using progressive disclosure to manage context efficiently."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create Personal Agent Skills (Priority: P1)

A developer wants to create reusable skills for their personal workflow that work across all their Wave projects. They need to package their expertise into discoverable capabilities that Wave can autonomously invoke when relevant.

**Why this priority**: This is the core value proposition - enabling users to extend Wave's capabilities with their own expertise.

**Independent Test**: Can be fully tested by creating a personal skill directory structure with SKILL.md file and verifying Wave can discover and use it across multiple projects.

**Acceptance Scenarios**:

1. **Given** I want to create a personal skill, **When** I create a directory at `~/.wave/skills/my-skill-name/` with a valid SKILL.md file, **Then** Wave should recognize and make this skill available across all my projects
2. **Given** I have created a personal skill with proper YAML frontmatter, **When** I interact with Wave in any project, **Then** Wave should autonomously decide when to invoke this skill based on my requests
3. **Given** I have a personal skill with supporting files, **When** Wave invokes the skill, **Then** it should have access to all referenced files (scripts, templates, documentation)

---

### User Story 2 - Create Project-Specific Agent Skills (Priority: P2)

A development team wants to create shared skills that encapsulate project-specific knowledge, team conventions, and workflows. These skills should be version-controlled and automatically available to all team members.

**Why this priority**: Enables team collaboration and knowledge sharing through skills, building on the foundation of personal skills.

**Independent Test**: Can be tested by creating project skills in `.wave/skills/` directory, committing to git, and verifying team members automatically have access.

**Acceptance Scenarios**:

1. **Given** I want to create a project skill, **When** I create a directory at `.wave/skills/my-skill-name/` with a valid SKILL.md file, **Then** the skill should be available to all team members working on this project
2. **Given** I commit project skills to git, **When** team members clone or pull the repository, **Then** they should automatically have access to these skills without additional setup
3. **Given** a project skill exists, **When** any team member interacts with Wave in this project, **Then** Wave should consider project-specific skills alongside personal skills

---

### User Story 3 - Skill Discovery and Invocation (Priority: P1)

Wave needs to autonomously discover when to use available skills based on user requests and skill descriptions, without requiring explicit user commands.

**Why this priority**: This is the core mechanism that makes skills useful - automatic, intelligent invocation based on context.

**Independent Test**: Can be tested by creating skills with specific descriptions and verifying Wave invokes them appropriately for matching requests.

**Acceptance Scenarios**:

1. **Given** I have skills with descriptive YAML frontmatter, **When** I make a request that matches a skill's purpose, **Then** Wave should autonomously decide to invoke that skill
2. **Given** multiple skills could apply to a request, **When** Wave evaluates available skills, **Then** it should choose the most relevant skill based on the description and context
3. **Given** a skill has supporting files, **When** Wave invokes the skill, **Then** it should progressively load only the files needed for the specific request

---

### User Story 4 - Skill Management and Validation (Priority: P3)

Users need to validate their skill definitions, understand skill structure requirements, and manage their skill collections effectively.

**Why this priority**: While important for usability, this builds on the core functionality and can be implemented after basic skill support works.

**Independent Test**: Can be tested by creating invalid skills and verifying appropriate error messages, plus managing skill collections.

**Acceptance Scenarios**:

1. **Given** I create a SKILL.md file with invalid YAML frontmatter, **When** Wave attempts to load the skill, **Then** it should provide clear error messages about what needs to be fixed
2. **Given** I have multiple skills available, **When** I request information about my skills, **Then** Wave should be able to list and describe available personal and project skills
3. **Given** I modify a skill's SKILL.md file, **When** I interact with Wave, **Then** it should automatically reload the updated skill definition

---

### User Story 5 - User-Invokable Skills with Arguments (Priority: P2)

A user wants to explicitly invoke a skill using a slash command syntax and provide arguments that are substituted into the skill's content. They also want skills to be able to execute bash commands to provide dynamic information.

**Why this priority**: Enhances the flexibility and power of skills, allowing them to function like custom slash commands while maintaining their discoverable nature.

**Independent Test**: Can be tested by invoking a skill with `/skill-name arg1 arg2` and verifying that `$1` and `$ARGUMENTS` are correctly substituted, and bash commands like !`pwd` are executed.

**Acceptance Scenarios**:

1. **Given** I have a skill with parameter placeholders (e.g., `$1`, `$ARGUMENTS`), **When** I invoke it using `/skill-name arg1 arg2`, **Then** Wave should substitute the placeholders with the provided arguments before processing
2. **Given** I have a skill with bash command placeholders (e.g., !`pwd`), **When** the skill is invoked, **Then** Wave should execute the bash commands and replace the placeholders with their output
3. **Given** a skill is registered, **When** I type `/` in the chat, **Then** the skill should appear in the slash command suggestions
4. **Given** I have a skill with NO parameter placeholders, **When** I invoke it using `/skill-name arg1 arg2`, **Then** Wave should automatically append the arguments to the end of the skill content

---

### User Story 6 - Restricting Tool Access for Skills (Priority: P2)

A user wants to restrict the tools available to the AI when a skill is invoked, either manually via a slash command or autonomously by the AI. This ensures that the AI uses only the intended tools for a specific task, improving security and reliability.

**Why this priority**: Enhances security and reliability by limiting the AI's toolset to what's necessary for the skill.

**Independent Test**: Can be tested by creating a skill with `allowed-tools` in its frontmatter and verifying that the AI is restricted to those tools when the skill is invoked.

**Acceptance Scenarios**:

1. **Given** I have a skill with `allowed-tools` specified in its frontmatter, **When** I invoke it using a slash command, **Then** Wave should restrict the AI to only use the specified tools for the resulting turn
2. **Given** a skill with `allowed-tools` is invoked autonomously by the AI via the `Skill` tool, **When** the skill is executed, **Then** Wave should enforce the tool restrictions for the remainder of the AI's turn
3. **Given** a skill specifies `allowed-tools` as a YAML list or a comma-separated string, **When** the skill is parsed, **Then** Wave should correctly identify and enforce all specified tools

---

### User Story 7 - Forking Skills into Subagents (Priority: P2)

A user wants to execute a complex skill in a separate subagent to provide a fresh context or use a specialized agent type. This helps in isolating the skill's execution and leveraging specific agent expertise.

**Why this priority**: Enhances the power of skills by allowing them to run in specialized contexts, improving the quality of results for complex tasks.

**Independent Test**: Can be tested by creating a skill with `context: fork` and an optional `agent` field in its frontmatter, and verifying that Wave executes the skill in a subagent of the specified type.

**Acceptance Scenarios**:

1. **Given** I have a skill with `context: fork` in its frontmatter, **When** the skill is invoked, **Then** Wave should execute the skill content in a new subagent instance
2. **Given** I have a skill with `context: fork` and `agent: typescript-expert`, **When** the skill is invoked, **Then** Wave should use a `typescript-expert` subagent to execute the skill
3. **Given** a skill is forked into a subagent, **When** the subagent is running, **Then** Wave should provide real-time updates on the subagent's progress (tools used, tokens consumed) in the tool's short result
4. **Given** I have a skill with `model: gpt-4o`, **When** the skill is invoked (manually or autonomously), **Then** Wave should use the specified model for the execution

---

### User Story 8 - Controlling Skill Invocation and Visibility (Priority: P2)

A user wants to control how skills are invoked and whether they are visible in the slash command menu. This allows for "internal" skills used only by the AI or "manual" skills that the AI should not trigger automatically.

**Why this priority**: Provides necessary control for complex skill ecosystems where some skills might be too powerful or specific for autonomous AI invocation, or where some skills are intended only as building blocks for the AI.

**Independent Test**: Can be tested by setting `disable-model-invocation: true` and `user-invocable: false` in various combinations and verifying visibility in the `/` menu and the AI's tool prompt.

**Acceptance Scenarios**:

1. **Given** a skill has `disable-model-invocation: true` in its frontmatter, **When** Wave generates the tool prompt for the AI, **Then** this skill should be excluded from the available skills list
2. **Given** a skill has `disable-model-invocation: true`, **When** the AI attempts to call it via the `Skill` tool, **Then** Wave should block the execution and return an error to the AI
3. **Given** a skill has `user-invocable: false` in its frontmatter, **When** I type `/` in the chat, **Then** the skill should NOT appear in the slash command suggestions
4. **Given** a skill has `user-invocable: false`, **When** I attempt to execute it via `/skill-name`, **Then** Wave should not recognize it as a valid command

---

### Edge Cases

- What happens when a skill's SKILL.md file has malformed YAML frontmatter?
- How does Wave handle conflicts between personal and project skills with the same name?
- What happens when referenced supporting files (scripts, templates) are missing or inaccessible?
- How does Wave handle skills with circular references in their supporting files?
- What happens when a skill's name exceeds the 64-character limit or contains invalid characters?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Wave MUST support personal skills stored in `~/.wave/skills/` directory structure
- **FR-002**: Wave MUST support project skills stored in `.wave/skills/` directory structure within projects
- **FR-003**: Wave MUST parse SKILL.md files with YAML frontmatter containing name and description fields
- **FR-004**: Wave MUST validate skill names use only lowercase letters, numbers, and hyphens (max 64 characters)
- **FR-005**: Wave MUST validate skill descriptions are within 1024 character limit
- **FR-006**: Wave MUST autonomously decide when to invoke skills based on user requests and skill descriptions
- **FR-007**: Wave MUST support progressive loading of supporting files (reference.md, examples.md, scripts, templates)
- **FR-008**: Wave MUST prioritize project skills over personal skills when both exist with the same name
- **FR-009**: Wave MUST provide clear error messages for malformed or invalid skill definitions
- **FR-010**: Wave MUST reload skill definitions when SKILL.md files are modified
- **FR-011**: Wave MUST handle missing or inaccessible supporting files gracefully
- **FR-012**: Wave MUST support skills with multiple supporting file types (markdown, scripts, templates)
- **FR-013**: Wave MUST support user-invokable skills via slash command syntax (e.g., `/skill-name args`)
- **FR-014**: Wave MUST support parameter substitution in skills using `$1`, `$2`, ..., and `$ARGUMENTS`
- **FR-015**: Wave MUST support bash command execution in skills using `!`command`` syntax
- **FR-016**: Wave MUST support `allowed-tools` in skill frontmatter to restrict tool access during skill execution
- **FR-017**: Wave MUST support `context: fork` and `agent:` in skill frontmatter to execute skills in specialized subagents
- **FR-018**: Wave MUST support `disable-model-invocation: true` in skill frontmatter to prevent AI from automatically triggering the skill
- **FR-019**: Wave MUST support `user-invocable: boolean` (default: `true`) in skill frontmatter to control visibility in the slash command menu
- **FR-020**: Wave MUST support `model:` in skill frontmatter to override the model configuration for skill execution (including forked subagents)

### Key Entities

- **Skill**: A discoverable capability package consisting of a SKILL.md file with YAML frontmatter (name, description, optional allowed-tools, disable-model-invocation, user-invocable, model) and optional supporting files
- **Personal Skill**: Skills stored globally in user's home directory (`~/.wave/skills/`) available across all projects
- **Project Skill**: Skills stored in project directory (`.wave/skills/`) shared with team members and version-controlled
- **Skill Directory**: Container holding SKILL.md and optional supporting files (reference.md, examples.md, scripts/, templates/)
- **Supporting File**: Additional resources referenced by skills for progressive disclosure (documentation, examples, utilities, templates)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can create a functional personal skill that Wave recognizes and invokes within 5 minutes of setup
- **SC-002**: Project teams can share skills through version control with zero additional configuration for team members
- **SC-003**: Wave correctly identifies and invokes the most relevant skill for user requests 90% of the time based on skill descriptions
- **SC-004**: Skills with supporting files load additional resources only when needed, reducing initial response time by maintaining under 500ms skill evaluation time
- **SC-005**: Invalid skill definitions provide actionable error messages that allow users to fix issues in under 2 minutes
- **SC-006**: Skill modifications are automatically detected and reloaded without requiring Wave restart or manual refresh