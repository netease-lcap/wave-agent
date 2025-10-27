# Research: Wave Skills Support

**Phase**: 0 - Research & Analysis  
**Date**: 2024-12-19  
**Status**: Complete

## Key Decisions Made

### Decision: Reuse Existing Markdown Parser
**Rationale**: The user specifically requested reusing the custom command's markdown meta parser. The existing `markdownParser.ts` already handles YAML frontmatter parsing with the exact format needed for skills (name, description fields).  
**Alternatives considered**: Create a new parser, use external YAML library  
**Chosen approach**: Extend existing `parseFrontmatter` function to handle skill-specific metadata validation

### Decision: Skill Tool Architecture
**Rationale**: User requested creating a "Skill tool" that includes all skills meta info in tool description but loads SKILL.md body only when invoked. This follows the progressive disclosure pattern.  
**Alternatives considered**: Load all skill content upfront, lazy loading per request  
**Chosen approach**: Tool description contains metadata for AI selection, body loaded on invocation with skill path included in result

### Decision: File Discovery Strategy
**Rationale**: Need to efficiently discover skills in both `~/.wave/skills/` and `.wave/skills/` directories with proper priority handling (project over personal).  
**Alternatives considered**: Polling, file watching, on-demand scanning  
**Chosen approach**: Initial scan on startup with file watching for updates, cache metadata for performance

### Decision: Tool Integration Pattern
**Rationale**: Skills must integrate seamlessly with existing tool system. The Skill tool acts as a meta-tool that can invoke specific skills.  
**Alternatives considered**: Each skill as separate tool, skill namespace system  
**Chosen approach**: Single Skill tool with skill name as parameter, following existing tool plugin pattern

## Technical Research

### Existing Markdown Parser Capabilities
- ✅ YAML frontmatter parsing with `parseFrontmatter` function
- ✅ Key-value pair extraction with type handling
- ✅ Array parsing for comma-separated values
- ✅ Error handling for malformed YAML
- **Extension needed**: Skill-specific validation (name format, description length)

### Tool System Integration Points
- ✅ Existing `ToolPlugin` interface with execute method
- ✅ `ToolManager` registration system
- ✅ `ChatCompletionFunctionTool` config format for AI
- **Extension needed**: Dynamic tool description generation from skill metadata

### File System Patterns
- ✅ Node.js fs module for file operations
- ✅ Path resolution for home directory (`~/.wave/skills/`)
- ✅ Recursive directory scanning for skill discovery
- **Extension needed**: File watching for skill updates, graceful error handling

### Performance Considerations
- ✅ Metadata caching to avoid repeated file parsing
- ✅ Lazy loading of skill bodies until invocation
- ✅ Efficient directory scanning with early termination
- **Target**: <500ms initial skill discovery, <100ms skill invocation

## Skill Structure Analysis

### SKILL.md Format (from user specification)
```yaml
---
name: skill-name  # lowercase, hyphens, max 64 chars
description: Brief description for AI discovery  # max 1024 chars
---

# Skill Content
Instructions and guidance for AI...
```

### Supporting Files Structure
```
skill-name/
├── SKILL.md (required)
├── reference.md (optional)
├── examples.md (optional)
├── scripts/ (optional)
└── templates/ (optional)
```

### Directory Priorities
1. Project skills (`.wave/skills/`) - highest priority
2. Personal skills (`~/.wave/skills/`) - fallback
3. Name conflicts: project overrides personal

## Implementation Approach

### Phase 1 Components
1. **SkillManager**: Discovery, caching, file watching
2. **Skill Tool**: Tool plugin with dynamic descriptions
3. **Parser Extensions**: Skill-specific validation
4. **Type Definitions**: Skill metadata and configuration types

### Integration Strategy
- Extend existing `ToolManager` to register Skill tool
- Reuse `markdownParser.ts` with skill-specific extensions
- Follow existing test patterns with unit tests in `tests/` and integration in `examples/`
- Maintain backward compatibility with existing tool system

## Risk Mitigation

### File System Errors
**Strategy**: Graceful degradation with clear error messages  
**Implementation**: Try-catch blocks with user-friendly fallbacks

### Performance Impact
**Strategy**: Metadata caching with lazy loading  
**Implementation**: In-memory cache with file modification tracking

### Skill Conflicts
**Strategy**: Clear priority rules with user notification  
**Implementation**: Project skills override personal, log conflicts

## Success Metrics Validation

All success criteria from spec are technically achievable:
- ✅ SC-001: 5-minute setup - file creation and recognition
- ✅ SC-002: Zero config team sharing - git-based .wave/skills/
- ✅ SC-003: 90% correct invocation - metadata-based selection
- ✅ SC-004: <500ms evaluation - cached metadata approach
- ✅ SC-005: 2-minute error fix - validation with clear messages
- ✅ SC-006: Auto-reload - file watching implementation

**Research Status**: ✅ COMPLETE - All technical unknowns resolved