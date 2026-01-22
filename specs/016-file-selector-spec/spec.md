# Feature Specification: File Selector

**Feature Branch**: `016-file-selector-spec`  
**Created**: 2026-01-22  
**Status**: In Progress  
**Input**: User description: "File Selector for quick file/directory selection"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Quick File Selection (Priority: P1)

As a user, I want to quickly find and select files by typing `@` so I don't have to type full paths manually.

**Why this priority**: This is the core functionality that improves user efficiency when referencing files in their messages.

**Independent Test**: Type `@` in the input field, type a partial filename, and verify that the correct file appears in the list and can be selected.

**Acceptance Scenarios**:

1. **Given** the cursor is in the input field, **When** the user types `@`, **Then** the file selector MUST appear.
2. **Given** the file selector is open, **When** the user types a query, **Then** the list MUST filter in real-time.
3. **Given** a file is highlighted, **When** the user presses `Enter` or `Tab`, **Then** the file path MUST be inserted into the input.

---

### User Story 2 - Directory Navigation (Priority: P2)

As a user, I want to navigate through directories using the file selector so I can find files deep in the project structure.

**Why this priority**: Projects often have complex directory structures, and being able to navigate them is essential.

**Independent Test**: Type `@`, select a directory, and verify that the selector now shows the contents of that directory.

**Acceptance Scenarios**:

1. **Given** the file selector is open, **When** a directory is selected, **Then** the selector MUST update to show the contents of that directory.
2. **Given** the selector is showing a subdirectory, **When** the user continues typing, **Then** it MUST search within that subdirectory.

---

### User Story 3 - Fuzzy Search (Priority: P3)

As a user, I want fuzzy search to find files even if I don't type the exact prefix or if I make minor typos.

**Why this priority**: Improves the robustness and ease of use of the search functionality.

**Independent Test**: Type `@` followed by a query that matches a file non-linearly (e.g., "mgt" for "management") and verify the file is found.

**Acceptance Scenarios**:

1. **Given** the file selector is open, **When** a fuzzy query is typed, **Then** relevant files SHOULD still be displayed in the results.

---

### Edge Cases

- **Empty directory**: If a directory is empty, the selector should show a "No files found" message or similar.
- **Permission denied**: If the agent doesn't have permission to read a directory, it should handle the error gracefully.
- **Very large directories**: The UI must remain responsive even when listing directories with thousands of files.
- **Special characters in paths**: Paths with spaces or special characters must be correctly escaped when inserted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST trigger the file selector when `@` is typed in the input field.
- **FR-002**: System MUST perform real-time, debounced (300ms) search of the filesystem.
- **FR-003**: System MUST display a list of matching files and directories with appropriate icons (📁/📄).
- **FR-004**: System MUST support keyboard navigation using `UpArrow`, `DownArrow`, `Enter`, `Tab`, and `Escape`.
- **FR-005**: System MUST insert the selected path at the cursor position, replacing the `@query` string.
- **FR-006**: System MUST automatically add a space after the inserted path.
- **FR-007**: System MUST support home directory (`~`) expansion.
- **FR-008**: System MUST limit the display to 10 items at a time with a scrolling mechanism.

### Key Entities *(include if feature involves data)*

- **FileItem**: Represents a file or directory in the list.
    - `name`: The name of the file or directory.
    - `path`: The full or relative path.
    - `type`: Whether it's a file or a directory.
- **SelectorState**: The state of the file selector in `InputManager`.
    - `isActive`: Whether the selector is currently visible.
    - `query`: The current search string.
    - `selectedIndex`: The index of the currently highlighted item.

## Assumptions

- The `searchFiles` utility in `wave-agent-sdk` provides the necessary filesystem access.
- The terminal environment supports the Ink-based UI components.
- The user has read access to the project directory.
