# Feature Specification: Tool Permission System

**Feature Branch**: `024-tool-permission-system`  
**Created**: 2025-12-08  
**Status**: Draft  
**Input**: User description: "1, currently, all edit and bash tools are executed without restriction, which is not safe, we should add `permissionMode` to agent's constructor, can be "default" or "bypassPermissions". 2, code CLI can pass --dangerously-skip-permissions to set permissionMode. 3, when permissionMode is default, all write edit multiedit delete bash should ask user to allow or deny. you can add `canUseTool` callback to agent sdk to do that. canUseTool take toolName return promise of {behavior: 'allow'} or {behavior: 'deny', message: '' }. canUseTool should be inserted in tool's execute function, after validation and diff, before real operation. 4, code CLI should add a comfirm component. keep simple. only has Do you want to proceed? 1.Yes, 2, Type here to tell Wave what to to differrently, can be switched by arrow up or down. 5, when permissionMode is bypassPermissions, same as current, all tools are executed without restriction."

## Clarifications

### Session 2025-12-08

- Q: Confirmation Timeout Behavior → A: Wait indefinitely until user responds (no timeout)
- Q: Callback Exception Handling → A: Deny the operation and abort
- Q: Alternative Instructions Processing → A: Send to agent through tool result field

- Q: Multiple Tool Call Confirmation Behavior → A: Each restricted tool call shows individual sequential confirmation prompts
- Q: Partial Denial Impact on Remaining Tool Calls → A: Continue with remaining tool calls, showing individual confirmations for each
- Q: Alternative Instructions Impact on Remaining Tool Calls → A: Continue with remaining tool calls and after confirm all tools, return tool results of all tools to AI
- Q: Sequential Confirmation Implementation Architecture → A: Queue-based approach with confirmation queue state management
- Additional: When confirmation is shown, InputBox should not be rendered; pressing ESC hides confirmation and aborts the tool operation

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Default Safe Mode with Confirmations (Priority: P1)

A user runs Wave CLI without any special flags, and the system prompts for confirmation before executing any potentially destructive operations like file edits, deletions, or bash commands.

**Why this priority**: This provides essential safety for the majority of users by preventing accidental destructive operations. It's the core security feature that protects user systems by default.

**Independent Test**: Can be fully tested by running any edit/delete/bash command and verifying that a confirmation prompt appears, allowing users to approve or deny the operation.

**Acceptance Scenarios**:

1. **Given** a user runs Wave CLI without flags, **When** Wave attempts to edit a file, **Then** a confirmation prompt appears asking "Do you want to proceed?" with options to allow or modify the request
2. **Given** a user runs Wave CLI without flags, **When** Wave attempts to delete a file, **Then** a confirmation prompt appears with allow/deny options
3. **Given** a user runs Wave CLI without flags, **When** Wave attempts to execute a bash command, **Then** a confirmation prompt appears with allow/deny options
4. **Given** a confirmation prompt is shown, **When** user selects "Yes", **Then** the operation proceeds normally
5. **Given** a confirmation prompt is shown, **When** user types alternative instructions, **Then** Wave receives the new instructions through the tool result field instead of executing the original operation
6. **Given** a confirmation prompt is shown, **When** user presses ESC key, **Then** the confirmation component is hidden and the tool operation is aborted
7. **Given** a user runs Wave CLI without flags, **When** Wave attempts to write a file, **Then** a confirmation prompt appears with allow/deny options
8. **Given** the AI returns multiple restricted tool calls in one response, **When** each tool call is executed, **Then** individual sequential confirmation prompts appear for each restricted tool, allowing granular approve/deny decisions
9. **Given** multiple tool calls are pending and one is denied, **When** processing continues, **Then** individual confirmation prompts still appear for each remaining restricted tool call
10. **Given** a user provides alternative instructions for one tool call in a sequence, **When** processing continues, **Then** the system continues with remaining tool calls and returns all tool results (including alternative instructions) to the AI after all confirmations are complete

---

### User Story 2 - Bypass Mode for Advanced Users (Priority: P2)

An advanced user or automated system runs Wave CLI with a special flag to bypass all permission checks for uninterrupted operation.

**Why this priority**: Essential for automation, CI/CD pipelines, and experienced users who understand the risks and need efficient operation without interruptions.

**Independent Test**: Can be fully tested by running Wave CLI with the bypass flag and verifying that no confirmation prompts appear for any operations.

**Acceptance Scenarios**:

1. **Given** a user runs Wave CLI with `--dangerously-skip-permissions`, **When** Wave attempts any edit/delete/bash operation, **Then** no confirmation prompts appear and operations execute immediately
2. **Given** bypass mode is enabled, **When** multiple destructive operations are performed, **Then** all execute without user intervention

---

### User Story 3 - Agent SDK Callback Integration (Priority: P3)

A developer integrating Wave's agent SDK can provide custom permission handling logic through the `canUseTool` callback to implement their own authorization workflows.

**Why this priority**: Enables custom integrations and enterprise use cases where organizations need to implement their own permission workflows or audit trails.

**Independent Test**: Can be tested by creating a test agent with a custom `canUseTool` callback and verifying it's called appropriately for restricted tools.

**Acceptance Scenarios**:

1. **Given** an agent is created with a `canUseTool` callback, **When** Wave attempts to use a restricted tool, **Then** the callback is invoked with the tool name
2. **Given** a `canUseTool` callback returns `{behavior: 'deny', message: 'Custom reason'}`, **When** a tool execution is attempted, **Then** the operation is blocked and the custom message is displayed
3. **Given** a `canUseTool` callback returns `{behavior: 'allow'}`, **When** a tool execution is attempted, **Then** the operation proceeds normally

---

### Edge Cases

- How does the system handle network timeouts or interruptions during confirmation prompts?
- What occurs when a `canUseTool` callback throws an exception or takes too long to respond? → System denies operation and aborts execution


## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Agent constructor MUST accept a `permissionMode` parameter with values "default" or "bypassPermissions"
- **FR-002**: Wave CLI MUST support a `--dangerously-skip-permissions` flag that sets permission mode to "bypassPermissions"
- **FR-003**: When permission mode is "default", system MUST prompt for user confirmation before executing Edit, MultiEdit, Delete, Bash, or Write tools
- **FR-004**: Agent SDK MUST support a `canUseTool` callback that receives tool name and returns Promise of permission decision
- **FR-005**: Permission callback MUST support response format `{behavior: 'allow'}` or `{behavior: 'deny', message: string}`
- **FR-006**: Permission checks MUST occur after tool validation and diff generation but before actual operation execution
- **FR-007**: CLI MUST include a confirmation component with "Do you want to proceed?" prompt that waits indefinitely for user response
- **FR-008**: Confirmation component MUST offer two options: "Yes" to proceed and text input for alternative instructions
- **FR-009**: Confirmation component MUST support navigation between options using arrow keys
- **FR-010**: When permission mode is "bypassPermissions", all tools MUST execute without permission checks
- **FR-011**: System MUST preserve existing tool functionality and interfaces when permissions are bypassed
- **FR-012**: Permission prompts MUST be non-blocking for read-only operations like Read, Grep, LS, and Glob tools
- **FR-013**: When `canUseTool` callback throws an exception or fails to respond, system MUST deny the operation and abort execution with appropriate error logging
- **FR-014**: When user provides alternative instructions in confirmation prompt, system MUST send those instructions to the agent through the tool result field instead of executing the original operation

- **FR-015**: When confirmation component is displayed, the main InputBox MUST be hidden and not rendered
- **FR-016**: When user presses ESC during confirmation prompt, the confirmation component MUST be hidden and the tool operation MUST be aborted
- **FR-017**: When AI returns multiple restricted tool calls in one response, system MUST display individual sequential confirmation prompts for each restricted tool, allowing granular approval/denial decisions per tool
- **FR-018**: When one tool call is denied in a sequence of multiple tool calls, system MUST continue processing remaining tool calls with individual confirmations for each restricted tool
- **FR-019**: When user provides alternative instructions for one tool call in a sequence, system MUST continue with remaining tool calls and return all tool results (including alternative instructions in tool result field) to the AI after all confirmations are complete
- **FR-020**: System MUST implement queue-based sequential confirmation for multiple tool calls, processing confirmations one at a time with proper state management

### Key Entities

- **Permission Mode**: Configuration setting that determines whether tools require user confirmation ("default") or execute without restriction ("bypassPermissions")
- **Tool Permission**: Authorization decision for a specific tool execution, containing behavior (allow/deny) and optional denial message
- **Confirmation Component**: Interactive UI element that presents permission prompts and collects user decisions
- **Permission Callback**: Function interface that allows custom permission logic integration in the Agent SDK

### Assumptions

- The Wave CLI runs in environments that support interactive terminal input for confirmation prompts
- Users understand that bypass mode (`--dangerously-skip-permissions`) removes safety protections
- Permission checks do not significantly impact tool execution performance
- The existing agent SDK architecture supports callback integration without breaking changes
- Read-only tools (Read, Grep, LS, Glob) are considered safe and don't require permission checks