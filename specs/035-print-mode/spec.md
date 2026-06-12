# Feature Specification: Print Mode

**Feature Branch**: `035-print-mode`
**Created**: 2026-06-09

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clean response-only output (Priority: P0)

As a user running `wave -p 'message'`, I want to see only the main agent's response text, so that the output is suitable for piping to other commands and scripts.

**Why this priority**: This is the fundamental purpose of print mode — machine-readable, clean output. Without it, `-p` is unusable for scripting.

**Independent Test**: Run `wave -p 'hi'` and verify only the assistant's response text is printed to stdout, with no subagent prompts, file lists, or internal housekeeping output.

**Acceptance Scenarios**:

1. **Given** print mode via `wave -p 'hi'`, **When** the agent responds, **Then** only the main agent's content is written to stdout.
2. **Given** print mode, **When** the auto-memory extraction subagent runs after the main response, **Then** no subagent output (system prompt, file manifest, reasoning, or content) appears on stdout.
3. **Given** print mode, **When** the agent uses the Agent tool, **Then** no subagent user messages or assistant streaming output is printed — only the main agent's tool block indicator and final response.

---

### User Story 2 - Streaming progress indicators (Priority: P2)

As a user running `wave -p` in a terminal, I want to see lightweight progress indicators (reasoning, tool calls) so I know the agent is working, even though subagent internals are suppressed.

**Why this priority**: Enhances UX but not required for core functionality.

**Independent Test**: Run `wave -p 'do something complex'` and verify reasoning headers, tool block names, and response content from the main agent are shown.

**Acceptance Scenarios**:

1. **Given** print mode with a complex prompt, **When** the main agent reasons before responding, **Then** a `💭 Reasoning:` header followed by reasoning text is printed.
2. **Given** print mode, **When** the main agent calls a tool, **Then** a `🔧 <tool_name> <compactParams>` line is printed.
3. **Given** print mode, **When** an error block is added, **Then** a `❌ Error: <message>` line is printed.

---

### User Story 3 - Compatibility with Claude Code behavior (Priority: P1)

As a user migrating from Claude Code, I want `wave -p` to behave like `claude -p` so that existing scripts and expectations work without changes.

**Why this priority**: Consistency with the reference implementation ensures a smooth migration path.

**Independent Test**: Compare output of `claude -p 'hi'` and `wave -p 'hi'` — both should show only the main agent's response text.

**Acceptance Scenarios**:

1. **Given** both `claude -p` and `wave -p`, **When** the same prompt is used, **Then** neither prints subagent internal output (user messages, system prompts, file manifests).
2. **Given** both tools, **When** a forked/background agent (e.g. memory extraction) runs, **Then** its output is completely silent — never emitted to stdout.
3. **Given** both tools, **When** a regular Agent tool subagent runs, **Then** the subagent's result is returned to the main agent as a tool_result and incorporated into the main agent's final response, not printed separately.

---

### Edge Cases

- **What happens if the main agent's response is empty?** Only a newline is printed.
- **What happens if a subagent errors?** The error propagates to the main agent as a tool_result; the main agent decides how to report it in its response. No subagent error is printed directly.
- **What happens with concurrent subagents?** All subagent output is suppressed regardless of concurrency.
- **What happens if auto-memory extraction runs while print mode is waiting for background work?** The `hasRunningBackgroundWork` loop waits for it, but no extraction output is printed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Print mode MUST only output the main agent's streaming content (reasoning, response text, tool blocks, error blocks) to stdout.
- **FR-002**: Print mode MUST NOT output any subagent user messages to stdout (no system prompts, instructions, or file manifests).
- **FR-003**: Print mode MUST NOT output any subagent assistant reasoning or content to stdout.
- **FR-004**: Print mode MUST NOT output any forked/background agent (e.g. auto-memory extraction) messages to stdout.
- **FR-005**: Print mode SHOULD display main agent reasoning with a `💭 Reasoning:` header when reasoning is present.
- **FR-006**: Print mode SHOULD display tool block indicators (`🔧 <name> <params>`) for main agent tool calls.
- **FR-007**: Print mode SHOULD display error blocks (`❌ Error: <message>`) for main agent errors.
