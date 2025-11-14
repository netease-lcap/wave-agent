# Hook Output Processing API

**Date**: 2025-11-14  
**Version**: 1.0.0  

## Hook Output Parser API

### Core Parser Functions

```typescript
// Main parsing function - converts raw hook output to structured format
POST /internal/hook/parse-output
Content-Type: application/json

Request:
{
  "exitCode": number,
  "stdout": string,
  "stderr": string,
  "hookEvent": "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop",
  "executionTime": number
}

Response:
{
  "source": "json" | "exitcode",
  "continue": boolean,
  "stopReason"?: string,
  "systemMessage"?: string,
  "hookSpecificData"?: HookSpecificOutput,
  "messageBlocks": MessageBlock[],
  "requiresUserInteraction": boolean,
  "permissionRequest"?: PendingPermission,
  "errors": string[]
}
```

### JSON Validation API

```typescript
// Validate hook JSON output against schema
POST /internal/hook/validate-json
Content-Type: application/json

Request:
{
  "jsonString": string,
  "hookEvent": "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop"
}

Response:
{
  "valid": boolean,
  "parsed"?: BaseHookJsonOutput & HookSpecificOutput,
  "errors": ValidationError[],
  "warnings": ValidationWarning[]
}
```

## Message Block Creation API

### Block Factory Functions

```typescript
// Create warning message block
POST /internal/message/create-warn-block
Content-Type: application/json

Request:
{
  "content": string,
  "hookEvent"?: "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop"
}

Response:
{
  "block": WarnBlock
}

// Create hook-specific message block  
POST /internal/message/create-hook-block
Content-Type: application/json

Request:
{
  "hookEvent": "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop",
  "content": string,
  "metadata"?: Record<string, any>
}

Response:
{
  "block": HookBlock
}
```

## Permission Management API

### Permission Request Handling

```typescript
// Create permission request for PreToolUse "ask" scenario
POST /internal/hook/create-permission-request
Content-Type: application/json

Request:
{
  "toolName": string,
  "reason": string,
  "originalInput": Record<string, any>,
  "updatedInput"?: Record<string, any>
}

Response:
{
  "permissionId": string,
  "request": PendingPermission
}

// Resolve permission request with user decision
POST /internal/hook/resolve-permission/{permissionId}
Content-Type: application/json

Request:
{
  "decision": "allow" | "deny",
  "reason"?: string
}

Response:
{
  "resolved": true,
  "decision": PermissionDecision,
  "shouldProceed": boolean
}

// Get pending permission requests
GET /internal/hook/pending-permissions

Response:
{
  "permissions": PendingPermission[]
}
```

## Hook Execution Integration API

### Enhanced Hook Execution

```typescript
// Execute hook with full output processing
POST /internal/hook/execute-with-output
Content-Type: application/json

Request:
{
  "hookConfig": {
    "command": string,
    "event": "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop",
    "matcher": string,
    "timeout": number
  },
  "input": {
    "session_id": string,
    "transcript_path": string,
    "cwd": string,
    "hook_event_name": string,
    "tool_name"?: string,
    "tool_input"?: Record<string, any>,
    "tool_response"?: Record<string, any>,
    "prompt"?: string
  }
}

Response:
{
  "raw": HookOutputResult,
  "parsed": ParsedHookOutput,
  "messageBlocks": MessageBlock[],
  "requiresUserInteraction": boolean,
  "permissionRequest"?: PendingPermission,
  "shouldContinue": boolean,
  "executionTime": number
}
```

## Message Conversion API Extensions

### API Message Conversion

```typescript
// Convert hook blocks for AI API consumption
POST /internal/message/convert-hook-blocks
Content-Type: application/json

Request:
{
  "blocks": (WarnBlock | HookBlock)[]
}

Response:
{
  "contentParts": ChatCompletionContentPart[]
}

// Convert full message with hook blocks
POST /internal/message/convert-message-for-api
Content-Type: application/json

Request:
{
  "message": {
    "role": "user" | "assistant",
    "blocks": MessageBlock[]
  }
}

Response:
{
  "apiMessage": ChatCompletionMessageParam
}
```

## Error Handling APIs

### Error Classification and Recovery

```typescript
// Classify hook output error and suggest recovery
POST /internal/hook/classify-error
Content-Type: application/json

Request:
{
  "exitCode": number,
  "stderr": string,
  "hookEvent": string,
  "hookCommand": string
}

Response:
{
  "errorType": "timeout" | "permission_denied" | "malformed_json" | "validation_failed" | "execution_failed",
  "severity": "warning" | "error" | "fatal",
  "message": string,
  "recovery": {
    "suggestion": string,
    "autoRetry": boolean,
    "fallbackBehavior": "continue" | "block" | "ask_user"
  }
}
```

## Webhook/Event APIs

### Hook Output Events

```typescript
// Hook output processing events for external integration
POST /webhook/hook/output-processed
Content-Type: application/json

Payload:
{
  "eventType": "hook_output_processed",
  "timestamp": number,
  "hookEvent": "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop",
  "toolName"?: string,
  "result": {
    "source": "json" | "exitcode", 
    "continue": boolean,
    "requiresUserInteraction": boolean
  },
  "sessionId": string
}

// Permission request events
POST /webhook/hook/permission-requested
Content-Type: application/json

Payload:
{
  "eventType": "permission_requested",
  "timestamp": number,
  "permissionId": string,
  "toolName": string,
  "reason": string,
  "sessionId": string
}

POST /webhook/hook/permission-resolved  
Content-Type: application/json

Payload:
{
  "eventType": "permission_resolved",
  "timestamp": number,
  "permissionId": string,
  "decision": "allow" | "deny",
  "processingTime": number,
  "sessionId": string
}
```

## Configuration APIs

### Hook Output Configuration

```typescript
// Get current hook output processing configuration
GET /api/hook/output-config

Response:
{
  "exitCodeBehavior": {
    "0": "success",
    "2": "blocking_error", 
    "others": "non_blocking_error"
  },
  "jsonPrecedence": true,
  "validationLevel": "strict" | "lenient",
  "timeoutMs": {
    "permissionRequest": 30000,
    "hookExecution": 10000
  },
  "uiConfig": {
    "keyboardNavigation": true,
    "autoExpandHookBlocks": false,
    "showHookExecutionTime": true
  }
}

// Update hook output configuration
PUT /api/hook/output-config
Content-Type: application/json

Request:
{
  "exitCodeBehavior"?: Record<string, string>,
  "jsonPrecedence"?: boolean,
  "validationLevel"?: "strict" | "lenient",
  "timeoutMs"?: Record<string, number>,
  "uiConfig"?: Record<string, any>
}

Response:
{
  "updated": true,
  "config": /* updated configuration */
}
```

## Health Check APIs

### Hook Output System Health

```typescript
// Check hook output processing system health
GET /internal/hook/health

Response:
{
  "status": "healthy" | "degraded" | "error",
  "components": {
    "parser": "healthy" | "error",
    "validation": "healthy" | "error", 
    "messageBlocks": "healthy" | "error",
    "permissions": "healthy" | "error"
  },
  "metrics": {
    "avgParsingTime": number,
    "avgValidationTime": number,
    "pendingPermissions": number,
    "errorRate": number
  },
  "timestamp": number
}
```

## Rate Limiting

### API Rate Limits

- Hook execution APIs: 100 requests/minute per session
- Permission management: 50 requests/minute per session  
- Validation APIs: 200 requests/minute per session
- Configuration APIs: 10 requests/minute per session
- Health check APIs: 60 requests/minute

### Error Responses

```typescript
// Rate limit exceeded
HTTP 429 Too Many Requests
{
  "error": "rate_limit_exceeded",
  "message": "Hook output API rate limit exceeded",
  "retryAfter": number, // seconds
  "limit": number,
  "remaining": 0
}

// Invalid request
HTTP 400 Bad Request  
{
  "error": "invalid_request",
  "message": "Invalid hook output request format",
  "details": ValidationError[]
}

// Internal error
HTTP 500 Internal Server Error
{
  "error": "internal_error",
  "message": "Hook output processing failed",
  "requestId": string,
  "timestamp": number
}
```