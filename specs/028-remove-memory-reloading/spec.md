# Feature Specification: Remove Memory File Live Reloading and Simplify Memory Architecture

**Feature Branch**: `028-remove-memory-reloading`  
**Created**: 2025-12-09  
**Status**: Draft  
**Input**: User description: "remove memory file live reloading and related code. I do not need this functionality any more. read memory files only when launch, remove packages/agent-sdk/src/types/memoryStore.ts packages/agent-sdk/src/services/memoryStore.ts , save memory in packages/agent-sdk/src/agent.ts"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Load Memory Files Only at Launch (Priority: P1)

As a developer using the agent SDK, I want memory files to be read only during agent initialization/launch, so that the system has a simpler architecture without continuous file monitoring and the memory content is loaded once at startup.

**Why this priority**: This is the core architectural change - shifting from continuous monitoring to one-time loading at startup, which simplifies the system and reduces overhead.

**Independent Test**: Can be fully tested by launching an agent, verifying memory content is loaded, then modifying memory files and confirming that the agent's memory content does not change until restart.

**Acceptance Scenarios**:

1. **Given** the agent SDK is starting up with memory files present, **When** the agent initializes, **Then** memory content should be loaded into the agent instance
2. **Given** the agent is running, **When** I modify memory files on disk, **Then** the agent's in-memory content should remain unchanged
3. **Given** the agent is restarted, **When** initialization occurs, **Then** the updated memory file content should be loaded

---

### User Story 2 - Consolidate Memory Storage in Agent Class (Priority: P1)

As a maintainer of the codebase, I want memory content to be stored directly in the Agent class rather than in separate memory store services, so that the architecture is simpler and there are fewer abstraction layers.

**Why this priority**: This architectural simplification removes unnecessary complexity and consolidates memory management into the main Agent class where it logically belongs.

**Independent Test**: Can be tested by reviewing the Agent class and confirming that memory content is stored as instance properties, and that separate memory store services no longer exist.

**Acceptance Scenarios**:

1. **Given** the Agent class, **When** I review its properties, **Then** memory content should be stored as instance variables
2. **Given** the codebase, **When** I search for memory store services, **Then** the MemoryStoreService class should not exist
3. **Given** the agent initialization, **When** the agent starts, **Then** memory content should be loaded directly into agent properties

---

### User Story 3 - Remove Memory Store Infrastructure (Priority: P2)

As a maintainer of the codebase, I want to remove the memory store type definitions and service files, so that the codebase is cleaner and doesn't have unused code.

**Why this priority**: This cleanup removes dead code and unused type definitions that are no longer needed after consolidating memory storage.

**Independent Test**: Can be tested by confirming that the memory store type definitions file and service file have been removed and that no code references them.

**Acceptance Scenarios**:

1. **Given** the codebase, **When** I search for memory store files, **Then** packages/agent-sdk/src/types/memoryStore.ts should not exist
2. **Given** the codebase, **When** I search for memory store services, **Then** packages/agent-sdk/src/services/memoryStore.ts should not exist
3. **Given** the remaining code, **When** I review imports, **Then** no files should import from the removed memory store files

---

### User Story 4 - Merge Configuration Management Components (Priority: P2)

As a maintainer of the codebase, I want to merge the ConfigurationWatcher and LiveConfigManager into a single component, so that the configuration management is less confusing and has a clearer separation of responsibilities.

**Why this priority**: This architectural cleanup eliminates confusion between similar components and creates a single point of responsibility for configuration management.

**Independent Test**: Can be tested by reviewing the codebase and confirming that only one configuration management component exists, and that it handles both settings watching and configuration coordination.

**Acceptance Scenarios**:

1. **Given** the codebase, **When** I search for configuration management files, **Then** there should be only one component handling live configuration
2. **Given** the Agent class, **When** I review its dependencies, **Then** it should only depend on one configuration manager
3. **Given** settings file changes, **When** they occur, **Then** the single merged component should handle both watching and coordination

---

### Edge Cases

- What happens when memory files don't exist at launch time?
- How does the system handle memory files that become corrupted or unreadable during launch?
- What happens to existing code that tries to manually update memory content after the memory store service is removed?
- How does the system handle memory content that was previously auto-updated but now needs manual management?
- What happens if the agent needs to be reloaded without restarting the entire process?
- How should the merged configuration component handle both settings watching and hook management?
- What happens to existing code that depends on separate ConfigurationWatcher and LiveConfigManager?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST read memory files only during agent initialization/launch
- **FR-002**: System MUST NOT automatically watch or reload memory files after initialization
- **FR-003**: System MUST store memory content directly in the Agent class instance
- **FR-004**: System MUST remove the MemoryStoreService class and related infrastructure
- **FR-005**: System MUST remove memory store type definitions (types/memoryStore.ts)
- **FR-006**: System MUST remove the memory store service file (services/memoryStore.ts)
- **FR-007**: System MUST remove all memory file watching functionality from LiveConfigManager
- **FR-008**: System MUST merge ConfigurationWatcher and LiveConfigManager into a single component
- **FR-009**: System MUST maintain all existing settings watching functionality in the merged component
- **FR-010**: System MUST update memory-related functions to work with the new Agent-based storage
- **FR-011**: System MUST not break any existing functionality that doesn't depend on live reloading
- **FR-012**: System MUST handle memory file loading errors gracefully during agent initialization

### Key Entities

- **Agent Class**: The main agent class that will now store memory content directly as instance properties
- **Memory Files**: The AGENTS.md and user memory files that will be read once during agent initialization
- **Merged Configuration Manager**: The single component that will handle both settings file watching and configuration coordination (combining LiveConfigManager and ConfigurationWatcher)
- **Memory Service Functions**: The utility functions (addMemory, readMemoryFile, etc.) that will be updated to work with Agent-based storage
- **File Watcher Service**: The underlying file watching infrastructure that will continue to be used by the merged configuration manager for settings files only

### Assumptions

- Memory content will be loaded once at agent startup and remain static during the agent's lifetime
- Manual memory content updates (through addMemory function) will still work but will only update files, not the in-memory content until restart
- The simplified architecture will not impact any critical system functionality
- Existing memory file formats and structures will remain unchanged
- The change will improve performance by eliminating file system watching overhead
- Tests and other code that depend on the MemoryStoreService will need to be updated to work with the new Agent-based approach
- Merging ConfigurationWatcher and LiveConfigManager will not affect settings file watching functionality
- The merged component will maintain all existing configuration management capabilities while simplifying the architecture
- Other components that depend on LiveConfigManager will need minimal updates to work with the merged component