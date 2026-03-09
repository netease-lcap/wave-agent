# Implementation Plan: Tool Permission System

**Branch**: `024-tool-permission-system` | **Status**: Implemented | **Spec**: [spec.md](./spec.md)

## Summary

Comprehensive tool permission system for Wave, featuring:
- **Permission Modes**: "default", "acceptEdits", "plan", "bypassPermissions".
- **Confirmation UI**: Interactive CLI prompts with alternative instructions and smart wildcard suggestions.
- **Wildcard Matching**: Support for `*` in allow/deny rules at any position.
- **Smart Heuristics**: Automatic suggestion of wildcard patterns for common commands.
- **Secure Pipelines**: Decomposition and validation of complex bash command chains.
- **Deny Rules**: Explicit `permissions.deny` support with precedence over allow rules.
- **Path-based Rules**: Fine-grained access control for file system tools (Read, Write, etc.).
- **Built-in Safety**: Automatic permission for safe commands (cd, ls, pwd) within the CWD.

## Technical Context

- **Language**: TypeScript
- **Packages**: `agent-sdk` (core logic), `code` (CLI interface)
- **Key Components**: `PermissionManager`, `Confirmation` component, `bashParser` (for heuristics and decomposition).

## Project Structure

### Source Code

```
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── agent.ts                    # Permission mode handling & callback integration
│   │   ├── managers/
│   │   │   ├── toolManager.ts         # Permission context injection
│   │   │   └── permissionManager.ts   # Core matching logic (wildcards, deny, safe list)
│   │   ├── utils/
│   │   │   └── bashParser.ts          # Pipeline decomposition & smart wildcard heuristics
│   │   └── tools/                     # Permission checks in restricted tools
│   └── tests/
│       ├── managers/
│       │   └── permissionManager.test.ts
│       └── utils/
│           └── bashWildcard.test.ts
├── code/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Confirmation.tsx       # UI for permission prompts & pattern editing
│   │   │   └── ChatInterface.tsx     # Conditional rendering of confirmation
│   │   └── contexts/
│   │       └── useChat.tsx           # Sequential confirmation queue management
```

## Implementation Strategy

1. **Foundational System**: Basic modes and confirmation UI.
2. **Advanced Matching**: Wildcards and smart heuristics.
3. **Pipeline Security**: Command decomposition and validation.
4. **Granular Control**: Deny rules and path-based permissions.
5. **Safe Defaults**: Built-in command list with path restrictions.
