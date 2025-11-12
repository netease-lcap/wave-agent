# Feature Specification: Refactor Hooks System File Structure

**Feature Branch**: `009-refactor-hooks-structure`  
**Created**: 2025-11-12  
**Status**: Draft  
**Input**: User description: "I would like to make a refactor for agent-sdk, move packages/agent-sdk/src/hooks files to corresponding location based on the constitution VII. Source Code Structure. since packages/agent-sdk/src/hooks/executor.ts is a singleton, I would like to move it to services too."

## Clarifications

### Session 2025-11-12

- Q: Where should HookManager be relocated after the refactoring? → A: Move HookManager to managers directory (follows constitution VII for "state-related logic")
- Q: Should the main package index.ts maintain backward compatibility by re-exporting hook components from their new locations? → A: Delete the hooks export entirely
- Q: Which hook utilities should be moved to the utils directory? → A: Move matcher to utils, move settings to services, move types.ts src/types/hooks.ts and src/types.ts to src/types/index.ts
- Q: Should test files be updated to import from the new component locations or maintain their current import patterns? → A: Update test imports to match new component locations
- Q: Should the executor remain as a class-based singleton or be refactored? → A: Change executor to function-based implementation and remove logger logic
- Q: How should test files be reorganized to align with the new source code structure? → A: Move test files to match source structure and remove tests/hooks directory

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer Imports Hook Components Correctly (Priority: P1)

A developer working with the agent-sdk needs to import hook-related components after the refactoring and expects them to be in their logical locations based on their responsibilities.

**Why this priority**: Essential for maintaining API compatibility and ensuring the refactoring doesn't break existing code.

**Independent Test**: Can be fully tested by importing all hook-related exports and verifying they resolve correctly and deliver the same functionality as before.

**Acceptance Scenarios**:

1. **Given** the hooks system has been refactored, **When** a developer imports `HookManager` from the managers module, **Then** the import resolves successfully and provides the same functionality
2. **Given** the executor has been moved to services as functions, **When** internal code references the executor functions, **Then** they resolve from their new location without errors

---

### User Story 2 - Codebase Follows Logical Architecture Patterns (Priority: P2)

Development teams working on the agent-sdk can navigate the codebase more intuitively because files are organized by their architectural role rather than being grouped arbitrarily.

**Why this priority**: Improves long-term maintainability and developer experience by following standard architectural patterns.

**Independent Test**: Can be tested by reviewing the file structure and verifying each file is in a directory that matches its responsibility (services for singletons, utils for utilities, etc.).

**Acceptance Scenarios**:

1. **Given** the refactoring is complete, **When** a developer looks for execution functions, **Then** they find the hook executor functions in the services directory alongside other services
2. **Given** the refactoring is complete, **When** a developer looks for utility functions, **Then** they find hook utilities in the utils directory with clear, purpose-driven names

---

### User Story 3 - Build and Test Systems Continue Working (Priority: P1)

The existing build pipeline, test suites, and any dependent projects continue to function without modification after the file structure changes.

**Why this priority**: Critical for preventing regression and ensuring the refactoring doesn't break CI/CD or dependent systems.

**Independent Test**: Can be tested by running the full test suite and build process and verifying all tests pass and builds succeed.

**Acceptance Scenarios**:

1. **Given** the files and tests have been moved, **When** the test suite runs with updated import statements and file locations, **Then** all existing tests continue to pass without functional changes
2. **Given** the package is built after refactoring, **When** external projects import individual hook components from their new locations, **Then** they work correctly with updated import paths

---

### Edge Cases

- What happens when the refactoring breaks import paths in test files?
- How does the system handle existing external dependencies on the old file structure?
- What happens if the executor function signatures change during the refactor from class to functions?
- What happens when test file movements break test discovery or test runner configuration?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST update all import statements to reference components in their new locations after the refactoring
- **FR-002**: System MUST move the hook executor functions to the services directory and refactor from class-based to function-based implementation
- **FR-003**: System MUST move hook matcher to utils directory as a pure utility function
- **FR-004**: System MUST move hook settings to services directory for IO-related configuration operations
- **FR-005**: System MUST reorganize type definitions by moving hooks/types.ts to src/types/hooks.ts and src/types.ts to src/types/index.ts
- **FR-006**: System MUST completely remove the hooks directory and relocate all components to their appropriate directories per constitution VII
- **FR-007**: System MUST update all internal import statements to reference the new file locations
- **FR-008**: System MUST remove the hooks export from the main index.ts file, requiring consumers to import individual components from their new locations
- **FR-009**: System MUST refactor the executor from class-based singleton to function-based implementation without logger dependencies
- **FR-010**: System MUST update all test files to import components from their new locations (managers, services, utils, types)
- **FR-011**: System MUST move test files to align with new source structure: manager.test.ts to tests/managers/, executor.test.ts to tests/services/, matcher.test.ts to tests/utils/, settings.test.ts to tests/services/, types.test.ts to tests/types/
- **FR-012**: System MUST remove the tests/hooks directory after moving all test files to their corresponding locations

### Key Entities

- **Hook Executor Functions**: Function-based service for executing hook commands, belongs in services directory without logger dependencies
- **Hook Manager**: Core orchestration component for state-related hook logic, belongs in managers directory
- **Hook Matcher**: Utility for pattern matching tool names, belongs in utils directory as pure utility function
- **Hook Settings**: Configuration loading service, belongs in services directory for IO-related operations
- **Hook Types**: Type definitions, will be moved to src/types/hooks.ts with main types.ts becoming src/types/index.ts
- **Hook Test Files**: Test files will be moved to align with source structure - manager tests to tests/managers/, executor tests to tests/services/, matcher tests to tests/utils/, settings tests to tests/services/, types tests to tests/types/

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All existing tests pass with updated import statements and aligned file structure after the refactoring
- **SC-002**: Build process completes successfully with zero TypeScript compilation errors
- **SC-003**: Hook components are importable from their new logical locations (managers, services, utils) with clear, predictable import paths
- **SC-004**: Code maintainability improves through logical file organization with function-based services and clear separation of concerns
- **SC-005**: Test file structure mirrors source code structure with tests/hooks directory completely removed