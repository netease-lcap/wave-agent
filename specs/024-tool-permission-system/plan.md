# Implementation Plan: Tool Permission System

**Branch**: `024-tool-permission-system` | **Status**: Implemented | **Spec**: [spec.md](./spec.md)

## Summary

Comprehensive tool permission system for Wave, featuring:
- **Permission Modes**: "default", "acceptEdits", "plan", "bypassPermissions", "dontAsk".
- **Confirmation UI**: Interactive CLI prompts with alternative instructions, smart wildcard suggestions, and interactive trust options.
- **Wildcard Matching**: Support for `*` in allow/deny rules at any position.
- **Smart Heuristics**: Automatic suggestion of wildcard patterns for common commands.
- **Secure Pipelines**: Decomposition and validation of complex bash command chains.
- **Deny Rules**: Explicit `permissions.deny` support with precedence over allow rules.
- **Path-based Rules**: Fine-grained access control for file system tools (Read, Write, etc.).
- **Built-in Safety**: Automatic permission for safe commands (cd, ls, pwd) within the CWD.
- **Split Chained Commands**: Splitting chained commands on "Don't ask again" and saving only non-safe parts.
- **Bash Confirmation Safety**: Hiding "Don't ask again" for dangerous, out-of-bounds, or write-redirection commands.
- **Programmatic and Session-specific Permissions**: `allowedTools` and `disallowedTools` in SDK and CLI.
- **Persistent Configuration**: `permissionMode` and `permissions.allow` settings in `settings.json` with hierarchy support.
- **Interactive Trust**: "Yes, and auto-accept edits" and "Yes, and don't ask again..." options in the confirmation prompt.
- **dontAsk Mode**: Non-interactive mode that auto-denies unapproved restricted tools.

## Technical Context

- **Language**: TypeScript
- **Packages**: `agent-sdk` (core logic), `code` (CLI interface)
- **Key Components**: `PermissionManager`, `Confirmation` component, `bashParser` (for heuristics and decomposition), `ConfigurationService`.

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
│   │   ├── services/
│   │   │   └── configurationService.ts # Configuration loading and persistence
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
6. **Programmatic and Session-specific Permissions**: `allowedTools` and `disallowedTools` in SDK and CLI.
7. **Persistent Configuration**: Support for `permissionMode` in `settings.json` and hierarchy resolution.
8. **Interactive Trust**: Enhanced confirmation prompt with auto-accept and persistent rule options.
9. **dontAsk Mode**: Implementation of auto-deny logic and system prompt injection.
