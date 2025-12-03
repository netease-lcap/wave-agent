# Data Model: Global Logger for Agent SDK

**Date**: 2025-12-01  
**Phase**: Phase 1 - Design & Contracts

## Entity Overview

This feature introduces a minimal data model focused on global state management for logger access across the SDK.

## Core Entities

### **Global Logger Registry**

**Purpose**: Manages the singleton logger instance accessible throughout the SDK

**Attributes**:
- `globalLogger: Logger | null` - The current logger instance (null when unconfigured)

**State Transitions**:
- `uninitialized` → `configured` (via setGlobalLogger with valid Logger)
- `configured` → `uninitialized` (via clearGlobalLogger or setGlobalLogger with null)
- `configured` → `configured` (via setGlobalLogger with different Logger)

**Validation Rules**:
- Logger instance must implement Logger interface when provided
- Null values are explicitly allowed (represents no-logger state)
- State changes are atomic (no partial updates)

**Relationships**:
- 1:1 relationship with Agent instance (one Agent sets the global logger)
- 1:N relationship with utility functions (many functions can access the logger)

### **Logger Interface** (existing)

**Purpose**: Defines the contract for logging implementations  
**Location**: `types/core.ts` (already exists)

**Attributes**:
- `debug(...args: unknown[]): void` - Debug level logging
- `info(...args: unknown[]): void` - Info level logging  
- `warn(...args: unknown[]): void` - Warning level logging
- `error(...args: unknown[]): void` - Error level logging

**Validation Rules**:
- All methods must be present (required interface)
- Methods should handle variable arguments gracefully
- No return values expected (void methods)

**Relationships**:
- Used by Global Logger Registry as the type constraint
- Implemented by external logging libraries (winston, pino, etc.)
- Consumed by Agent class for dependency injection

## State Management

### **Global State**
```typescript
// Module-level state in utils/globalLogger.ts
let globalLogger: Logger | null = null;
```

**Access Patterns**:
- **Write**: Single writer (Agent class during initialization)
- **Read**: Multiple readers (utility functions, services)
- **Lifecycle**: Matches Agent instance lifecycle

**Thread Safety**: Safe in Node.js single-threaded environment

### **State Validation**

**Initialization States**:
1. **Uninitialized** (`null`): Default state, logging calls are no-ops
2. **Configured** (`Logger`): Active logger, all calls are forwarded

**Error Conditions**:
- No errors for uninitialized state (graceful degradation)
- Runtime errors propagate from underlying Logger implementation

## API Surface

### **Registry Functions**
```typescript
// Global logger management
setGlobalLogger(logger: Logger | null): void
clearGlobalLogger(): void
isLoggerConfigured(): boolean
```

### **Logging Functions**  
```typescript
// Zero-overhead logging interface
logger.debug(...args: unknown[]): void
logger.info(...args: unknown[]): void
logger.warn(...args: unknown[]): void
logger.error(...args: unknown[]): void
```

## Integration Points

### **Agent Class Integration**
- Constructor receives optional Logger via AgentOptions
- Sets global logger during initialization if provided
- Maintains existing dependency injection pattern

### **Utility Function Integration**
- Import logging functions from global logger module
- Replace console.* calls with appropriate logger methods
- No function signature changes required

### **Service Integration**
- Enable commented-out logger calls in services
- Add contextual logging for debugging operations
- Maintain existing service interfaces

## Performance Characteristics

### **Memory Usage**
- Single module-level variable (minimal overhead)
- No object creation per log call
- Logger instance lifecycle managed by caller

### **CPU Usage**
- Single null check per log call when unconfigured
- Direct function delegation when configured  
- No intermediate object allocation

### **I/O Impact**
- Dependent on underlying Logger implementation
- Global logger adds no additional I/O operations
- Async logging support depends on Logger choice

## Testing Considerations

### **Mock Requirements**
- Mock Logger interface for unit tests
- Global state reset between test cases
- Verification of log call forwarding

### **Test Data**
```typescript
// Standard mock logger for testing
interface MockLogger {
  debug: Mock<void, unknown[]>
  info: Mock<void, unknown[]>  
  warn: Mock<void, unknown[]>
  error: Mock<void, unknown[]>
}
```

### **State Isolation**
- Each test must reset global logger state
- No shared state between test cases
- Independent verification of log calls

## Migration Impact

### **Backward Compatibility**
- No breaking changes to existing APIs
- Existing logger injection continues to work
- Additive enhancement only

### **Gradual Migration Path**
1. Add global logger registry (no impact)
2. Update Agent to set global logger (no breaking change)  
3. Replace console calls in utilities (improvement)
4. Enable service logging (new functionality)