# Data Model: Wave Skills Support

**Phase**: 1 - Design & Contracts  
**Date**: 2024-12-19  
**Dependencies**: research.md

## Core Entities

### Skill
Represents a discoverable capability package with metadata and optional supporting files.

**Attributes**:
- `name: string` - Unique identifier (lowercase, hyphens, max 64 chars)
- `description: string` - Purpose and usage context for AI discovery (max 1024 chars)
- `skillPath: string` - Directory path containing skill and supporting files
- `content: string` - Full markdown content (loaded lazily)
- `type: 'personal' | 'project'` - Skill location type

**Validation Rules**:
- Name must match `/^[a-z0-9-]+$/` and be ≤ 64 characters
- Description must be ≤ 1024 characters and non-empty
- FilePath must exist and be readable
- Content must have valid YAML frontmatter

**Relationships**:
- Belongs to one SkillCollection (personal or project)
- May reference supporting files within skill directory

### SkillCollection
Container for organizing skills by location and providing priority resolution.

**Attributes**:
- `type: 'personal' | 'project'` - Collection location type
- `basePath: string` - Root directory path
- `skills: Map<string, Skill>` - Skills indexed by name
- `errors: SkillError[]` - Collection-level errors

**Validation Rules**:
- BasePath must be a valid directory
- Skills map must not contain duplicate names within collection

**Relationships**:
- Contains multiple Skills
- Managed by one SkillManager



## Composite Types

### SkillMetadata
Lightweight skill information for tool descriptions and caching.

```typescript
interface SkillMetadata {
  name: string;
  description: string;
  type: 'personal' | 'project';
  skillPath: string;
}
```

### SkillValidationResult
Result of skill parsing and validation operations.

```typescript
interface SkillValidationResult {
  isValid: boolean;
  skill?: Skill;
  errors: string[]; // Human-readable error messages
}
```

### SkillInvocationContext
Context information passed during skill execution.

```typescript
interface SkillInvocationContext {
  skillName: string;
}
```

## State Transitions

### Skill Lifecycle
1. **Discovered** - Found during directory scan
2. **Parsing** - YAML frontmatter being processed
3. **Validated** - Metadata validated successfully
4. **Cached** - Metadata stored in memory (available for AI tool description)
5. **Loaded** - Full content loaded when AI invokes specific skill by name
6. **Invalid** - Failed validation, excluded from tool descriptions

### Collection Management
1. **Uninitialized** - SkillCollection created but not scanned
2. **Scanning** - Directory being read for skills
3. **Ready** - Skills loaded and available
4. **Error** - Directory inaccessible or other issues

## Data Constraints

### Performance Constraints
- Skill metadata must fit in memory (target: <10MB for 1000 skills)
- Directory scans must complete within 500ms
- Skill content loading must complete within 100ms

### File System Constraints
- Personal skills directory: `~/.wave/skills/` (may not exist initially)
- Project skills directory: `.wave/skills/` (relative to working directory)
- Skill directories must contain `SKILL.md` file
- Supporting files must be within skill directory tree

### Concurrency Constraints
- Multiple skill invocations may occur simultaneously
- Directory scans should not block AI tool execution
- Skill content caching must handle concurrent access

## Error Handling Strategy

### Graceful Degradation Levels
1. **Skill Level** - Invalid individual skills excluded, others remain available
2. **Collection Level** - Failed directories logged as warnings, continue with available collections
3. **System Level** - Tool remains functional even if no skills found

### User-Facing Error Categories
- **Configuration Errors**: Invalid SKILL.md format, missing required fields
- **Access Errors**: Permission denied, file not found, directory inaccessible
- **Validation Errors**: Name format violations, description too long
- **System Errors**: Parsing exceptions, unexpected system errors

### Recovery Mechanisms
- **Skip invalid skills** - Continue discovery with other skills when one fails
- **Clear error messages** - Provide actionable error information in logs
- **Graceful fallback** - Tool remains functional even if no skills are found

