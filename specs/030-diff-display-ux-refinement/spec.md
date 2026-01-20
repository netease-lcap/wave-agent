# Feature Specification: Diff Display UX Refinement

**Feature Branch**: `030-diff-display-ux-refinement`  
**Created**: 2025-12-11  
**Status**: Draft  
**Input**: User description: "remove diffblock and packages/code/src/components/DiffViewer.tsx and all related code, show diff in packages/code/src/components/Confirmation.tsx and ToolResultDisplay.tsx when stage is end. diff should based on parameters"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Unified Tool Result Display (Priority: P1)

As a user interacting with the Wave agent, I want to see file differences directly within tool execution results so that I can understand what changes tools made without switching between different display sections.

**Why this priority**: This is the core functionality that consolidates diff display into a single, consistent location, improving user experience and code maintainability.

**Independent Test**: Can be fully tested by executing any tool that produces file changes and verifying the differences appear within the tool results display when the tool has completed, or within the confirmation dialog before execution.

**Acceptance Scenarios**:

    1. **Given** a tool execution that modifies files, **When** the tool is running, **Then** the file differences should NOT be displayed within the tool results area (to keep the UI clean during execution)
    2. **Given** a tool execution has completed with file changes, **When** viewing the tool result, **Then** the differences should be visible in the tool results display
    3. **Given** a tool execution requires user confirmation, **When** the confirmation dialog is shown, **Then** the file differences should be displayed within the confirmation dialog to allow user review before execution
    4. **Given** a tool execution with no file changes, **When** viewing the result or confirmation, **Then** no file differences should be displayed in any state

---

### User Story 2 - Removed Separate Diff Components (Priority: P2)

As a developer maintaining the codebase, I want the separate difference display functionality removed so that file difference display logic is centralized and not duplicated across multiple interface sections.

**Why this priority**: Code cleanup and maintainability improvement that follows the primary functionality consolidation.

**Independent Test**: Can be tested by confirming that separate difference display functionality no longer exists and no references to separate diff interfaces remain in the codebase while difference functionality still works through the unified tool results display.

**Acceptance Scenarios**:

1. **Given** the consolidation is complete, **When** searching for separate difference display imports, **Then** no interface sections should import or reference the removed difference display functionality
2. **Given** the old difference display code is removed, **When** the application runs, **Then** difference functionality should work exclusively through the unified tool results display
    3. **Given** message display no longer renders difference blocks, **When** a difference needs to be displayed, **Then** it should only appear in the tool results area or confirmation dialog

---

### User Story 3 - Tool-Specific Diff Display (Priority: P3)

As a user, I want file difference display to show appropriate content based on the type of tool being executed so that I can understand exactly what changes are being made in the most relevant format.

**Why this priority**: Provides contextually appropriate difference display that matches the nature of each tool's operations, improving clarity and user understanding.

**Independent Test**: Can be tested by executing Write, Edit, and MultiEdit tools and verifying the difference display matches the expected format for each tool type.

**Acceptance Scenarios**:

1. **Given** a Write tool execution, **When** creating or overwriting a file, **Then** only the content parameter should be displayed as new additions
2. **Given** an Edit tool execution, **When** modifying a file with old_string and new_string parameters, **Then** the difference should show old_string parameter being replaced by new_string parameter
3. **Given** a MultiEdit tool execution, **When** performing multiple edits with multiple old_string/new_string pairs, **Then** the difference should show each old_string vs new_string parameter pair from the edits array

---

### Edge Cases

- What happens when a tool produces very large file differences that could impact performance?
- How does the system handle difference display when multiple tools are running simultaneously?
- What occurs when file difference data is corrupted or unavailable?
- How are file differences handled for binary file changes?

## Assumptions

- Existing file difference visualization capabilities (word-level comparison, context handling, visual styling) will be preserved during consolidation
- Tool execution states ("running" and "end") are already defined and tracked within the system
- Write tool operates with file_path and content parameters, creating or overwriting files
- Edit tool operates with file_path, old_string, new_string, and optional replace_all parameters
- MultiEdit tool operates with file_path and an array of edit objects (each containing old_string, new_string, replace_all)
- Current difference calculation logic using diffLines() is sound and will be reused for parameter-based comparisons
- Tool results display component has both collapsed and expanded states that can show content
- No external dependencies are required for the consolidation

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST remove the existing separate file difference display interface
- **FR-002**: System MUST remove all separate difference block functionality and references throughout the application
- **FR-003**: System MUST integrate file difference display functionality into the tool results display area and confirmation dialog
- **FR-004**: System MUST display file differences within tool results ONLY when tool execution stage is "end"
- **FR-004b**: System MUST display file differences within the confirmation dialog when a tool requires user approval
- **FR-005**: System MUST determine file difference display content based solely on tool parameters (Write shows content parameter as new additions, Edit shows old_string vs new_string comparison, MultiEdit shows each old_string vs new_string pair from edits array)
- **FR-006**: System MUST maintain existing file difference visualization capabilities (word-level comparison, context handling, visual styling) within the tool results display
- **FR-007**: System MUST ensure no functionality loss during the consolidation process
- **FR-008**: Tool results display MUST render file difference information in both collapsed and expanded states when difference data is available
- **FR-009**: System MUST remove file difference rendering logic from message display areas
- **FR-010**: System MUST update tool result data structure to include optional file difference information
- **FR-011**: Write tool difference display MUST show content parameter as new additions (without reading original file content)
- **FR-012**: Edit tool difference display MUST show old_string parameter being replaced by new_string parameter
- **FR-013**: MultiEdit tool difference display MUST show each old_string vs new_string pair from the edits parameter array

### Key Entities *(include if feature involves data)*

- **Tool Result**: Extended to include optional file difference information, represents tool execution results with potential file changes
- **File Difference**: Contains the actual difference information that shows what changed between file states
- **Tool Results Display**: Enhanced interface area that now handles both tool output and associated file differences in a unified view