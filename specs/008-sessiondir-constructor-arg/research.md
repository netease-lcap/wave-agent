# Research Report: SessionDir Constructor Argument

**Date**: 2025-11-11  
**Feature**: SessionDir Constructor Argument  
**Purpose**: Resolve implementation patterns and validate technical approach

## Research Tasks Completed

### 1. Session Directory Configuration Patterns

**Decision**: Use optional constructor parameter with fallback to default value  
**Rationale**: 
- Maintains backward compatibility by making parameter optional
- Follows existing AgentOptions pattern established in the codebase
- Allows runtime configuration without breaking existing integrations
- Consistent with other optional configuration parameters (workdir, logger, etc.)

**Alternatives considered**:
- Environment variable only: Rejected because it's less flexible for programmatic use
- Static method configuration: Rejected because it breaks the existing constructor pattern
- Global configuration: Rejected because it doesn't support multiple Agent instances with different sessionDirs

### 2. Directory Resolution Strategy

**Decision**: Resolve sessionDir in MessageManager constructor, pass down to session service functions  
**Rationale**:
- MessageManager is already responsible for session management coordination
- Centralizes configuration resolution in one place
- Maintains single responsibility principle - each service function doesn't need to handle resolution
- Follows existing pattern where MessageManager coordinates session operations

**Alternatives considered**:
- Resolve in each session service function: Rejected due to duplication and multiple resolution points
- Global singleton configuration: Rejected due to lack of support for multiple Agent instances

### 3. Backward Compatibility Approach

**Decision**: Maintain existing hardcoded SESSION_DIR as default, parameterize all session functions  
**Rationale**:
- Zero breaking changes - existing code continues to work without modification
- Default behavior remains identical for users not specifying sessionDir
- Clean separation between new functionality and existing behavior
- Easy to test both code paths independently

**Alternatives considered**:
- Deprecate old constructor: Rejected because it would require migration for all users
- Version-based API: Rejected as unnecessarily complex for this additive feature

### 4. Error Handling Strategy

**Decision**: Leverage existing directory creation and error handling patterns from ensureSessionDir  
**Rationale**:
- Reuses proven error handling logic already in the codebase
- Consistent error messages and behavior across default and custom directories
- ensureSessionDir already handles permission issues, path validation, etc.
- No need to reinvent directory validation and creation logic

**Alternatives considered**:
- Validate sessionDir at Agent construction time: Rejected because it would make Agent creation async
- Custom validation logic: Rejected due to duplication of existing robust validation

### 5. Testing Strategy

**Decision**: Integration tests with temporary directories, unit tests with mocking  
**Rationale**:
- Integration tests verify real file system behavior as required by constitution
- Temporary directories ensure test isolation and cleanup
- Existing session service tests can be extended to cover custom directory scenarios
- Follows established testing patterns in the codebase

**Alternatives considered**:
- Unit tests only: Rejected because session operations involve real file system interactions
- Real directories in tests: Rejected due to potential conflicts and cleanup issues

## Implementation Approach Validation

The research confirms the implementation approach:

1. **Interface Extension**: Add `sessionDir?: string` to AgentOptions
2. **Constructor Modification**: Pass sessionDir from Agent constructor to MessageManager
3. **MessageManager Update**: Store sessionDir and pass to session service calls
4. **Session Service Parameterization**: Update all session functions to accept optional sessionDir parameter
5. **Directory Resolution**: Use provided sessionDir or fall back to existing SESSION_DIR constant
6. **Testing**: Comprehensive tests covering both default and custom directory behavior

This approach aligns with established patterns in the codebase and maintains full backward compatibility while providing the requested functionality.