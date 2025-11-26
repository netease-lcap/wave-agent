# Data Model: Session Management Improvements

**Date**: 2025-11-26  
**Status**: ✅ IMPLEMENTED - SIMPLIFIED

## Overview

This document defines the essential data entities for the improved session management system. **Focuses on core functionality that's actually being used** - removed unused complexity to maintain clean, maintainable codebase.

## Core Entities (IMPLEMENTED)

### 1. Session Metadata Line (First Line)

The first line of each JSONL file containing essential session metadata.

**Entity**: `SessionMetadataLine`

**Fields**:
- **__meta__**: `true` - Special marker to identify metadata line
- **sessionId**: `string` - UUIDv6 session identifier
- **sessionType**: `'main' | 'subagent'` - Type of session for agent hierarchy
- **parentSessionId**: `string?` - Parent session ID for subagents only
- **subagentType**: `string?` - Subagent type identifier for subagents only (e.g., 'typescript-expert')
- **workdir**: `string` - Original working directory path
- **startedAt**: `string` - ISO 8601 session start timestamp

**Purpose**:
- Enables metadata-first JSONL architecture
- Allows efficient metadata reading without loading all messages
- Supports session hierarchy (main/subagent) through metadata
- Eliminates need for file-path-based session type detection

---

### 2. Session Message (JSONL Lines)

Individual lines in JSONL files representing discrete messages with timestamps.

**Entity**: `SessionMessage` (extends existing `Message` interface)

**Fields**:
- **role**: `'user' | 'assistant'` - Message role in conversation (from Message interface)
- **blocks**: `MessageBlock[]` - Array of content blocks (from Message interface)
- **timestamp**: `string` - ISO 8601 timestamp when message was created (added for JSONL format)
- **usage**: `Usage?` - Usage data for AI operations (from Message interface, assistant messages only)
- **metadata**: `Record<string, unknown>?` - Additional metadata from AI responses (from Message interface)

**Purpose**:
- Extends existing Wave message format with timestamp for JSONL storage
- Maintains compatibility with existing message processing
- Enables temporal ordering and session activity tracking

---

### 3. Session Metadata (Derived)

Runtime metadata about sessions used for listing and management operations.

**Entity**: `SessionMetadata` (defined in `services/session.ts`)

**Fields**:
- **id**: `string` - UUIDv6 session identifier
- **sessionType**: `'main' | 'subagent'` - Type of session (from metadata line)
- **parentSessionId**: `string?` - Parent session ID (from metadata line, subagents only)
- **subagentType**: `string?` - Subagent type (from metadata line, subagents only)
- **workdir**: `string` - Original working directory path (from metadata line)
- **startedAt**: `Date` - Session start time (from metadata line)
- **lastActiveAt**: `Date` - Last message timestamp (derived from last message line)
- **latestTotalTokens**: `number` - Total token usage (derived from last assistant message with usage)

**Purpose**:
- Derived from JSONL file content for efficient session listing
- Used by session management APIs
- Combines metadata line data with derived statistics

---

### 4. Session Data (Runtime)

Complete session data structure used by the agent system.

**Entity**: `SessionData` (defined in `services/session.ts`)

**Fields**:
- **id**: `string` - UUIDv6 session identifier
- **messages**: `Message[]` - Array of messages (timestamps removed for compatibility)
- **metadata**: Object containing:
  - **workdir**: `string` - Working directory
  - **startedAt**: `string` - Session start timestamp
  - **lastActiveAt**: `string` - Last activity timestamp
  - **latestTotalTokens**: `number` - Total token usage

**Purpose**:
- Provides backward compatibility with existing agent code
- Bridges JSONL storage format with runtime message processing
- Maintains existing Agent API contracts

## Architecture Principles ✅

### **1. Metadata-First Design**
- Session metadata stored as first line with `__meta__: true` marker
- Enables efficient metadata access without reading entire file
- Supports streaming operations for large sessions

### **2. Streaming Operations**
- `readMetadata()` - reads only first line
- Memory-efficient processing for large session files

### **3. UUIDv6 Time Ordering**
- Session IDs are UUIDv6 for natural time-based sorting
- No need for separate creation timestamps
- Enables efficient "latest session" operations

### **4. Project-Based Organization**
- Sessions organized by working directory using PathEncoder
- Encoded directory names for filesystem safety
- Isolated session storage per project

## Removed Complexity ❌

The following entities were **removed** as they were never used in the actual implementation:

- ❌ **SessionFile** - File operations handled directly with paths
- ❌ **SessionDirectory** - Directory operations handled by utilities  
- ❌ **ProjectDirectory** - PathEncoder defines its own interface
- ❌ **SessionMetadataV2** - Replaced by working SessionMetadata
- ❌ **SessionCreationOptions** - Functions use direct parameters
- ❌ **SessionListFilter** - Functions use simple workdir parameter
- ❌ **SessionLoadOptions** - Functions use direct parameters
- ❌ **MessageAppendOptions** - Functions use direct parameters
- ❌ **SessionCleanupOptions** - Functions use direct parameters
- ❌ **SessionDataV2** - Replaced by working SessionData

## Performance Characteristics ✅

### Time Complexity
- **Session Creation**: O(1) - Direct file creation with UUIDv6
- **Message Append**: O(1) - JSONL line append operation
- **Metadata Access**: O(1) - First line only streaming read
- **Session Listing**: O(n) - Directory scan + metadata reads
- **Session Loading**: O(m) - Stream processing, where m = message count

### Space Complexity
- **Memory Usage**: O(1) for streaming operations, O(m) for full session loading
- **Disk Usage**: Linear with message count, no duplication overhead
- **Directory Structure**: Efficiently encoded project paths

This simplified data model focuses on **core functionality that's actually being used** while maintaining all essential capabilities for session management! 🚀