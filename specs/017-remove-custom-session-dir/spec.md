# Feature Specification: Remove Custom Session Dir Feature

**Feature Branch**: `017-remove-custom-session-dir`  
**Created**: 2025-11-25  
**Status**: Draft  
**Input**: User description: "remove custom session dir feature"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clean API Simplification (Priority: P1)

SDK users want a simplified Agent creation API without session directory configuration complexity, using only the default session storage location. This eliminates configuration options that add unnecessary complexity to the SDK interface.

**Why this priority**: This is the core change that removes the custom session directory feature entirely, simplifying the SDK API surface.

**Independent Test**: Can be fully tested by creating an Agent and verifying that sessions are stored only in the default location (~/.wave/projects) with no sessionDir-related code paths.

**Acceptance Scenarios**:

1. **Given** I create an Agent using Agent.create(), **When** I inspect the AgentOptions interface, **Then** no sessionDir parameter exists
2. **Given** I create an Agent, **When** sessions are saved, **Then** they are stored exclusively in the default directory
3. **Given** I perform any session operations, **When** they execute, **Then** they use hardcoded default paths only

---

### User Story 2 - Removed Configuration Complexity (Priority: P2)

Developers no longer need to consider or handle session directory configuration, as the SDK uses a single fixed path for all session storage, reducing cognitive overhead and potential misconfiguration.

**Why this priority**: Eliminates decision fatigue and configuration complexity that doesn't provide significant value to most users.

**Independent Test**: Can be fully tested by reviewing the codebase and verifying no sessionDir parameters exist in any public APIs or internal functions.

**Acceptance Scenarios**:

1. **Given** I examine the Agent SDK API, **When** I look for session configuration options, **Then** I find only default behavior with no customization
2. **Given** I review session-related functions, **When** I check their parameters, **Then** none accept sessionDir arguments
3. **Given** I create multiple Agent instances, **When** they operate, **Then** they all use identical session storage paths

---

### Edge Cases

- What happens to MessageManager instances that currently accept sessionDir parameters?
- How does SubagentManager handle session directory resolution when sessionDir is removed?
- What happens to existing session utility functions that currently accept sessionDir parameters?
- How do test files that mock sessionDir functionality need to be updated?
- What happens to applications currently using custom sessionDir when they upgrade?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: AgentOptions interface MUST NOT include sessionDir parameter
- **FR-002**: Agent constructor MUST NOT accept or process sessionDir parameter
- **FR-003**: MessageManager MUST use hardcoded default session directory path (~/.wave/projects) exclusively
- **FR-004**: Session service functions MUST use hardcoded SESSION_DIR constant and NOT accept sessionDir parameter
- **FR-005**: All session operations (save, load, list, delete, cleanup) MUST use the default session directory exclusively
- **FR-006**: SubagentManager MUST handle session paths using only the default directory
- **FR-007**: All sessionDir-related parameters MUST be removed from function signatures throughout the codebase
- **FR-008**: Session path computation MUST be simplified to use only default directory logic
- **FR-009**: Test files MUST be updated to remove sessionDir mocking and testing scenarios
- **FR-010**: resolveSessionDir function MUST be removed or simplified to return only the default path

### Key Entities *(include if feature involves data)*

- **AgentOptions**: Configuration interface with sessionDir parameter removed
- **MessageManager**: Manager class with sessionDir handling removed
- **SessionService**: Service functions with sessionDir parameters removed
- **Default Session Directory**: Fixed path at ~/.wave/projects for all session storage

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All Agent instances use only the default session directory with no sessionDir configuration options
- **SC-002**: TypeScript compilation fails with clear errors when attempting to use sessionDir parameter
- **SC-003**: All session operations execute using hardcoded default paths only
- **SC-004**: Codebase complexity reduced by removing sessionDir parameter handling from 100% of affected functions
- **SC-005**: All tests pass without sessionDir-related configuration or mocking
- **SC-006**: No sessionDir-related code remains in any public or internal APIs