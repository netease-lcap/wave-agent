# Data Model: Hooks System

**Date**: 2024-12-19  
**Feature**: Hooks Support  
**Source**: Extracted from functional requirements FR-001 through FR-010

## Core Entities

### HookConfiguration
**Purpose**: Root configuration structure for all hook definitions  
**Location**: ~/.wave/settings.json and .wave/settings.json

**Fields**:
- `hooks`: Record<HookEvent, HookEventConfig[]> - Maps hook events to their configurations

**Validation Rules**:
- Must contain valid HookEvent keys only
- Each event can have multiple configurations for different matchers

**State Transitions**: Static configuration, loaded at runtime

---

### HookEventConfig  
**Purpose**: Configuration for hooks responding to a specific event  

**Fields**:
- `matcher?: string` - Optional pattern for tool-based events (PreToolUse, PostToolUse)
- `hooks: HookCommand[]` - Array of commands to execute

**Validation Rules**:
- matcher is required for PreToolUse and PostToolUse events
- matcher should be omitted for UserPromptSubmit and Stop events
- hooks array must contain at least one HookCommand

**Relationships**: 
- Contains multiple HookCommand instances
- Belongs to a specific HookEvent

---

### HookCommand
**Purpose**: Individual command definition for execution

**Fields**:
- `type: "command"` - Command type (currently only "command" supported)  
- `command: string` - Bash command to execute

**Validation Rules**:
- type must be "command"
- command must be non-empty string
- command can reference $WAVE_PROJECT_DIR environment variable

**State Transitions**: Immutable once loaded

---

### HookEvent  
**Purpose**: Enumeration of supported hook trigger points

**Values**:
- `PreToolUse` - Triggered before tool parameter processing
- `PostToolUse` - Triggered after successful tool completion
- `UserPromptSubmit` - Triggered when user submits a prompt  
- `Stop` - Triggered when AI response cycle completes

**Validation Rules**: Must be one of the four defined values

---

### HookExecutionContext
**Purpose**: Runtime context provided to hook during execution

**Fields**:
- `event: HookEvent` - The triggering event
- `toolName?: string` - Name of tool for tool-based events
- `projectDir: string` - Absolute path to project directory
- `timestamp: Date` - Execution timestamp

**Validation Rules**:
- toolName required for PreToolUse and PostToolUse events
- projectDir must be absolute path
- timestamp must be valid Date

**State Transitions**: Created per execution, immutable during hook execution

---

### HookExecutionResult
**Purpose**: Result of hook command execution

**Fields**:
- `success: boolean` - Whether command executed successfully
- `exitCode?: number` - Process exit code  
- `stdout?: string` - Standard output from command
- `stderr?: string` - Standard error from command
- `duration: number` - Execution time in milliseconds
- `timedOut: boolean` - Whether execution was terminated due to timeout

**Validation Rules**:
- duration must be positive number
- exitCode should be provided if process completed
- success should correlate with exitCode (0 = success)

**State Transitions**: Created once per hook execution, immutable after creation

## Configuration Example

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command", 
            "command": "eslint --fix \"$WAVE_PROJECT_DIR\"/src"
          },
          {
            "type": "command",
            "command": "prettier --write \"$WAVE_PROJECT_DIR\"/src"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$WAVE_PROJECT_DIR\"/.wave/validate-prompt.sh"
          }
        ]
      }
    ]
  }
}
```