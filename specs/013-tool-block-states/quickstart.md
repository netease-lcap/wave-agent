# Quickstart: Tool Block Stage Updates

**Feature**: Enhanced `onToolBlockUpdated` callback with stage-based lifecycle
**Date**: 2025-11-20
**Branch**: 013-tool-block-states

## Overview

The `onToolBlockUpdated` callback now provides detailed stage information for tool execution lifecycle, replacing the ambiguous `isRunning` boolean with clear stage semantics.

## Basic Usage

### 1. Subscribe to Tool Updates
```typescript
import { Agent } from '@wave/agent-sdk';

const agent = await Agent.create({
  // ... other config
  onToolBlockUpdated: (params) => {
    // Handle tool execution events with stage information
    console.log(`[${params.stage}] ${params.name}`);
  }
});
```

### 2. Handle Different Stages
```typescript
function handleToolUpdate(params: AgentToolBlockUpdateParams) {
  switch (params.stage) {
    case 'start':
      // Tool execution beginning
      console.log(`🚀 Starting: ${params.name}`);
      console.log(`📋 Parameters: ${params.parameters}`);
      break;
      
    case 'streaming':
      // Incremental parameter or result updates
      if (params.parametersChunk) {
        console.log(`📝 Param chunk: ${params.parametersChunk}`);
      }
      if (params.result) {
        console.log(`📊 Result chunk: ${params.result}`);
      }
      break;
      
    case 'running':
      // Tool still working (no new output)
      console.log('⏳ Still running...');
      break;
      
    case 'end':
      // Execution completed
      if (params.error) {
        console.error(`❌ Failed: ${params.error}`);
      } else {
        console.log(`✅ Result: ${params.result}`);
      }
      break;
  }
}
```

## Lifecycle Examples

### Simple Tool (No Streaming)
```
[start] File Search Tool - Parameters: {"pattern":"*.txt"}
[running] File Search Tool  
[end] File Search Tool - Result: Found 42 files
```

### Parameter Streaming Tool
```
[start] Code Generation Tool - Parameters: ""
[streaming] Code Generation Tool - Param chunk: "function"
[streaming] Code Generation Tool - Param chunk: " hello() {"
[streaming] Code Generation Tool - Param chunk: "  return"
[streaming] Code Generation Tool - Param chunk: " 'world';"
[streaming] Code Generation Tool - Param chunk: "}"
[end] Code Generation Tool - Result: function hello() { return 'world'; }
```

### Result Streaming Tool
```
[start] Data Analysis Tool - Parameters: {"dataset":"sales.csv"}
[streaming] Data Analysis Tool - Result chunk: "Processing"
[streaming] Data Analysis Tool - Result chunk: " 10,000"
[streaming] Data Analysis Tool - Result chunk: " records"
[running] Data Analysis Tool
[end] Data Analysis Tool - Result: Analysis complete: $1.2M revenue
```

### Long-Running Tool
```
[start] Data Processing Tool - Parameters: {"size":"large"}
[running] Data Processing Tool
[running] Data Processing Tool  
[running] Data Processing Tool
[end] Data Processing Tool - Result: Processed 10,000 records
```

## Migration Guide

### Before (Deprecated)
```typescript
// OLD WAY - Ambiguous state tracking
if (params.isRunning) {
  console.log('Tool is running...');
} else if (params.parametersChunk) {
  console.log(`Parameter update: ${params.parametersChunk}`);
} else if (params.result) {
  console.log(`Result: ${params.result}`);
}
```

### After (Stage-Based)
```typescript
// NEW WAY - Clear stage-based handling
switch (params.stage) {
  case 'start':
    console.log(`Starting: ${params.name} with ${params.parameters}`);
    break;
  case 'streaming':
    if (params.parametersChunk) {
      console.log(`Parameter: ${params.parametersChunk}`);
    }
    if (params.result) {
      console.log(`Result: ${params.result}`);
    }
    break;
  case 'running':
    console.log('Still running...');
    break;
  case 'end':
    console.log(params.error ? `Failed: ${params.error}` : `Done: ${params.result}`);
    break;
}
```

## Best Practices

### 1. Always Handle All Stages
```typescript
// Good - Comprehensive handling
function handleAllStages(params: AgentToolBlockUpdateParams) {
  switch (params.stage) {
    case 'start': /* ... */ break;
    case 'streaming': /* ... */ break;
    case 'running': /* ... */ break;
    case 'end': /* ... */ break;
  }
}
```

### 2. Use Pattern Matching for Type Safety
```typescript
// TypeScript knows params.parametersChunk exists when needed
if (params.stage === 'streaming' && params.parametersChunk) {
  appendToDisplay(params.parametersChunk); // ✅ Type-safe
}
```

### 3. Build Rich UI Experiences
```typescript
// Example: Progress tracking UI
let progress = 0;

function updateUI(params: AgentToolBlockUpdateParams) {
  switch (params.stage) {
    case 'start':
      showToolHeader(params.name, params.parameters);
      progress = 0;
      break;
    case 'streaming':
      if (params.parametersChunk) {
        appendParameters(params.parametersChunk);
      }
      if (params.result) {
        appendResult(params.result);
      }
      progress += 10; // Simulate progress
      updateProgressBar(progress);
      break;
    case 'running':
      showSpinner(); // Indicate ongoing work
      break;
    case 'end':
      hideSpinner();
      showFinalResult(params.result, params.error);
      break;
  }
}
```

## Common Patterns

### Debouncing Streaming Output
```typescript
let parameterBuffer = '';
let resultBuffer = '';
let debounceTimer: NodeJS.Timeout;

function handleStreaming(params: AgentToolBlockUpdateParams) {
  if (params.stage === 'streaming') {
    if (params.parametersChunk) {
      parameterBuffer += params.parametersChunk;
    }
    if (params.result) {
      resultBuffer += params.result;
    }
    
    // Debounce UI updates for performance
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (parameterBuffer) updateParameters(parameterBuffer);
      if (resultBuffer) updateResults(resultBuffer);
      parameterBuffer = '';
      resultBuffer = '';
    }, 100);
  }
}
```

### Execution Time Tracking
```typescript
let startTime: number;

function trackExecution(params: AgentToolBlockUpdateParams) {
  switch (params.stage) {
    case 'start':
      startTime = Date.now();
      break;
    case 'end':
      const duration = Date.now() - startTime;
      console.log(`Tool completed in ${duration}ms`);
      break;
  }
}
```

## Error Handling

### Graceful Error Display
```typescript
function handleErrors(params: AgentToolBlockUpdateParams) {
  if (params.stage === 'end' && params.error) {
    // Show user-friendly error message
    showErrorNotification(
      `Tool ${params.name} failed: ${params.error}`
    );
    
    // Log detailed error for debugging
    console.error('Tool execution failed:', {
      tool: params.name,
      parameters: params.parameters,
      error: params.error
    });
  }
}
```

## Testing Your Integration

### Mock Events for Testing
```typescript
// Test your handler with mock events
const mockEvents: AgentToolBlockUpdateParams[] = [
  {
    stage: 'start',
    id: 'test-tool',
    name: 'Test Tool',
    parameters: '{"test": true}'
  },
  {
    stage: 'streaming',
    id: 'test-tool', 
    name: 'Test Tool',
    parameters: '{"test": true}',
    parametersChunk: 'Hello '
  },
  {
    stage: 'streaming',
    id: 'test-tool',
    name: 'Test Tool', 
    parameters: '{"test": true}',
    parametersChunk: 'World!'
  },
  {
    stage: 'end',
    id: 'test-tool',
    name: 'Test Tool',
    parameters: '{"test": true}',
    result: 'Hello World!'
  }
];

// Test your handler
mockEvents.forEach(handleToolUpdate);
```

## Important Notes

### Command Output vs Tool Execution
```typescript
// Command output blocks (for system commands) remain UNCHANGED
// They still use isRunning: boolean and are separate from tool execution
interface CommandOutputBlock {
  type: "command_output";
  command: string;
  output: string;
  isRunning: boolean; // ← STILL EXISTS for commands
  exitCode: number | null;
}
```

### Field Reference
- **`parameters`**: Full tool parameters (always available)
- **`parametersChunk`**: Streaming parameter updates (during `streaming` stage)
- **`result`**: Final or incremental result content
- **`error`**: Error information (during `end` stage)
- **`stage`**: Execution lifecycle phase (required)
- **`isRunning`**: **REMOVED** - No longer present in tool events

## Support

For questions or issues with the new stage-based API, refer to:
- Full API documentation in `contracts/typescript-interface.md`
- Data model details in `data-model.md`
- Implementation plan in `plan.md`
- Existing code examples in `packages/agent-sdk/examples/`

## Migration Checklist

- [ ] Update all `onToolBlockUpdated` handlers to use `stage` field
- [ ] Remove all `isRunning` checks from tool-related code
- [ ] Add comprehensive stage-based logic
- [ ] Test command output functionality remains unaffected
- [ ] Verify TypeScript compilation passes
- [ ] Test all existing tool execution scenarios