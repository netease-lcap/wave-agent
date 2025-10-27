# Tool API Contract: Skill Tool

**Version**: 1.0.0  
**Type**: Internal Tool Plugin  
**Integration**: Agent Tool System

## Skill Tool Interface

### Tool Registration

```typescript
const skillTool: ToolPlugin = {
  name: "Skill",
  description: "Invoke skills based on available skill metadata. Skills: {dynamicSkillList}",
  config: {
    type: "function",
    function: {
      name: "Skill",
      description: "Invoke a skill to apply specialized expertise and capabilities",
      parameters: {
        type: "object",
        properties: {
          skill_name: {
            type: "string",
            description: "Name of the skill to invoke from available skills"
          }
        },
        required: ["skill_name"],
        additionalProperties: false
      }
    }
  },
  execute: async (args: SkillToolArgs, context: ToolContext) => Promise<ToolResult>
}
```

### Input Contract

```typescript
interface SkillToolArgs {
  skill_name: string; // Must match existing skill name
}

interface ToolContext {
  abortSignal?: AbortSignal;
  backgroundBashManager?: BackgroundBashManager;
  workdir: string; // Used for resolving .wave/skills/ path
  skillManager?: ISkillManager; // Added for skill support
}
```

**Validation Rules**:
- `skill_name` must exist in discovered skills
- `skill_name` validation performed in execute() method, not schema
- Name format and length constraints handled by tool implementation

### Output Contract

Returns standard `ToolResult` interface:

```typescript
interface ToolResult {
  success: boolean;
  content: string; // Full SKILL.md content with skill path context
  error?: string;
  shortResult?: string; // Skill name and brief description
}
```

**Success Response Structure**:
```
Skill: {skill_name} (Type: {personal|project})
Path: {skillPath}

{SKILL.md content with instructions}
```

**Error Response Structure**:
```
Error invoking skill '{skill_name}': {error_message}

Available skills:
- skill-1: Description of skill 1
- skill-2: Description of skill 2
```

## SkillManager Interface

### Discovery Methods

```typescript
interface SkillManager {
  // Initialize skill discovery
  initialize(): Promise<void>;
  
  // Get all available skills metadata
  getAvailableSkills(): SkillMetadata[];
  
  // Load specific skill content
  loadSkill(skillName: string): Promise<Skill | null>;
}
```

### Skill Discovery Contract

```typescript
interface SkillDiscoveryResult {
  personalSkills: Map<string, SkillMetadata>;
  projectSkills: Map<string, SkillMetadata>;
  errors: SkillError[];
}

interface SkillError {
  skillPath: string;
  message: string;
}
```

## File System Contracts

### Directory Structure Contract

```
Personal Skills:
~/.wave/skills/
├── skill-name-1/
│   ├── SKILL.md (required)
│   ├── reference.md (optional)
│   └── scripts/ (optional)
└── skill-name-2/
    └── SKILL.md (required)

Project Skills:
{workdir}/.wave/skills/
├── team-skill-1/
│   ├── SKILL.md (required)
│   ├── examples.md (optional)
│   └── templates/ (optional)
└── team-skill-2/
    └── SKILL.md (required)
```

### SKILL.md Contract

**Required Format**:
```yaml
---
name: skill-name
description: Brief description of what this skill does and when to use it
---

# Skill Content
Markdown content with instructions...
```

**Validation Contract**:
- YAML frontmatter must be valid and parseable
- `name` field must match directory name
- `name` must be lowercase letters, numbers, hyphens only
- `description` must be 1-1024 characters
- Content body must be valid markdown

### Supporting Files Contract

**Access Contract**:
- All supporting files must be within skill directory
- Relative paths in SKILL.md content must resolve within skill directory
- Supporting files are included in skill path context for relative resolution
- Users can organize additional resources as needed (documentation, scripts, templates, etc.)

## Error Handling Contract

### Error Categories

```typescript
type SkillErrorType = 
  | 'skill_not_found'      // Requested skill doesn't exist
  | 'skill_invalid'        // Skill failed validation
  | 'skill_inaccessible'   // File system access denied
  | 'skill_malformed'      // YAML parsing failed
  | 'system_error';        // Unexpected system error

interface SkillErrorDetails {
  type: SkillErrorType;
  skillName?: string;
  message: string;
  suggestions?: string[];  // Actionable recommendations
  availableSkills?: string[]; // Alternative skills
}
```

### Error Response Contract

**Not Found Error**:
```
Skill '{skill_name}' not found.

Available skills:
- {available_skill_1}: {description}
- {available_skill_2}: {description}

To create this skill:
1. Create directory ~/.wave/skills/{skill_name}/
2. Add SKILL.md file with proper YAML frontmatter
```

**Validation Error**:
```
Skill '{skill_name}' is invalid: {validation_error}

Fix by:
- {specific_fix_1}
- {specific_fix_2}

Skill will be available after fixing these issues.
```

## Performance Contract

### Response Time Requirements
- Skill discovery initialization: < 500ms
- Individual skill loading: < 100ms
- Tool description generation: < 50ms
- Error message generation: < 10ms

### Memory Usage Contract
- Metadata cache: < 10MB for 1000 skills
- Content cache: < 50MB for 100 loaded skills

### Concurrency Contract
- Multiple simultaneous skill invocations supported
- Thread-safe skill loading and caching
- Non-blocking file system operations

## Integration Points

### Tool Manager Integration
```typescript
// Registration in ToolManager constructor
const skillManager = new SkillManager(options);
const skillTool = new SkillTool(skillManager);
this.tools.set(skillTool.name, skillTool);
```

### Skill Parser Integration
```typescript
// New dedicated skill parsing function
interface ParsedSkillFile {
  frontmatter: SkillFrontmatter;
  content: string;
  skillMetadata: SkillMetadata;
  validationErrors: string[];
  isValid: boolean;
}

function parseSkillFile(filePath: string): ParsedSkillFile;
```