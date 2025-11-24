# Session Management API Contracts

**Date**: 2025-11-24  
**Status**: Design Phase  

This directory contains API contracts and interface definitions for the session management improvements feature that implements project-based session organization with JSONL format and UUIDv6 identifiers.

## Contract Files

### Core Interfaces
- `session-interfaces.ts` - Core TypeScript interfaces for session entities and message structures
- `session-service.ts` - Session service API contract for project-based session management
- `path-encoder.ts` - Path encoding utility interface for converting working directories to safe directory names
- `jsonl-handler.ts` - JSONL file operations interface for efficient message appending and reading

## Design Principles

1. **Project-Based Organization**: Sessions are grouped by encoded working directory paths under `~/.wave/projects`
2. **JSONL Format**: Each message is stored as a separate line for efficient appending without full file rewrites
3. **UUIDv6 Identifiers**: Time-ordered session IDs enable chronological sorting without reading file contents
4. **Type Safety**: All interfaces use strict TypeScript typing aligned with core messaging types
5. **Performance**: Interfaces designed for streaming operations and minimal file I/O
6. **Clean Break**: No backward compatibility with existing JSON sessions - fresh start with new system

## Key Features

- **Directory Structure**: `~/.wave/projects/{encoded-workdir}/{uuidv6}.jsonl`
- **Message Format**: Each JSONL line contains a message with timestamp metadata only
- **Path Encoding**: Working directories encoded to safe filesystem names (e.g., `/home/user/project` → `-home-user-project`)
- **Session Identification**: UUIDv6 filename serves as session ID, workdir derived from parent directory
- **Time Ordering**: UUIDv6 properties enable efficient `getLatestSession()` operations

## Usage

These contracts define the public API surface for the new session management system. Implementation classes must conform to these interfaces to ensure proper project-based organization, JSONL handling, and UUIDv6-based session management.