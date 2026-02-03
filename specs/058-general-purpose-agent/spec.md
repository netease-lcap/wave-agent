# Feature Specification: General-Purpose Agent

**Feature Branch**: `058-general-purpose-agent`  
**Created**: 2026-02-03  
**Status**: Draft  
**Input**: User description: "{agentType:\"general-purpose\",whenToUse:\"General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.\",tools:[\"*\"],source:\"built-in\",baseDir:\"built-in\",getSystemPrompt:()=>\`You are an agent. Given the user's message, you should use the tools available to complete the task. Do what has been asked; nothing more, nothing less. When you complete the task simply respond with a detailed writeup.

Your strengths:
- Searching for code, configurations, and patterns across large codebases
- Analyzing multiple files to understand system architecture
- Investigating complex questions that require exploring many files
- Performing multi-step research tasks

Guidelines:
- For file searches: Use Grep or Glob when you need to search broadly. Use Read when you know the specific file path.
- For analysis: Start broad and narrow down. Use multiple search strategies if the first doesn't yield results.
- Be thorough: Check multiple locations, consider different naming conventions, look for related files.
- NEVER create files unless they're absolutely necessary for achieving your goal. ALWAYS prefer editing an existing file to creating a new one.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested.
- In your final response always share relevant file names and code snippets. Any file paths you return in your response MUST be absolute. Do NOT use relative paths.
- For clear communication, avoid using emojis.\`}"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Accessing the General-Purpose Subagent (Priority: P1)

As a developer, I want to be able to delegate complex research, multi-step tasks, and code modifications to a specialized subagent so that the main agent can focus on high-level coordination while the subagent handles the heavy lifting of codebase exploration and implementation.

**Why this priority**: This is the core requirement. While the `Explore` subagent handles read-only tasks, the `general-purpose` subagent is essential for tasks that require both deep research and the ability to modify files.

**Independent Test**: Can be fully tested by verifying that the `general-purpose` agent is registered in the system and can be invoked via the `Task` tool with full tool access.

**Acceptance Scenarios**:

1. **Given** the Wave Agent system, **When** listing available subagents, **Then** both "Explore" and "general-purpose" are included.
2. **Given** a task requiring file edits, **When** the main agent calls the `Task` tool with `subagent_type: "general-purpose"`, **Then** the subagent is successfully initialized with its specific system prompt and full tool access (`*`).

---

### User Story 2 - Complementary Subagent Roles (Priority: P2)

As a system maintainer, I want the `general-purpose` subagent to complement the `Explore` subagent by providing write capabilities and a broader operational scope, while maintaining consistent safety guidelines (like absolute paths and no proactive docs).

**Why this priority**: Ensures a clear distinction between the fast, read-only `Explore` agent and the more capable, implementation-focused `general-purpose` agent.

**Independent Test**: Can be tested by comparing the configurations of `Explore` and `general-purpose` subagents to ensure they have distinct toolsets and system prompts.

**Acceptance Scenarios**:

1. **Given** the `general-purpose` subagent, **When** it is created, **Then** it has access to all tools (`*`), unlike `Explore` which is restricted to read-only tools.
2. **Given** a subagent response, **When** it completes a task, **Then** the output follows the guidelines defined in its system prompt (e.g., absolute paths, no emojis), consistent with other built-in agents.

### Edge Cases

- **What happens if the subagent fails to initialize?** The system should handle the error gracefully and report to the main agent that the subagent task could not be completed.
- **How are tool conflicts handled?** Since the subagent has access to all tools (`*`), the system must ensure that tool execution within the subagent context doesn't interfere with the main agent's state.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST register a built-in agent with `agentType: "general-purpose"`.
- **FR-002**: System MUST define the `whenToUse` metadata for the general-purpose agent, highlighting its strengths in multi-step research and implementation compared to the read-only `Explore` agent.
- **FR-003**: System MUST provide the general-purpose agent with the specific `getSystemPrompt` that defines its research and implementation strengths.
- **FR-004**: System SHOULD omit the `tools` field in the `general-purpose` agent configuration to allow default full tool access.
- **FR-005**: System MUST set `scope: "builtin"` and use a placeholder `filePath` (e.g., `"<builtin:general-purpose>"`) to identify its built-in status.
- **FR-006**: System MUST ensure the general-purpose agent is available as a valid target for the `Task` tool.
- **FR-007**: System MUST integrate the `general-purpose` agent into the `getBuiltinSubagents` utility alongside the `Explore` agent.

### Key Entities *(include if feature involves data)*

- **General-Purpose Agent**: The specialized agent instance with specific system prompts and tool access.
- **Research Task**: A multi-step process of searching, reading, and analyzing files to answer a user query.
- **Final Writeup**: The synthesized response containing absolute paths and code snippets, formatted without emojis.
