# Quickstart: Wave Skills Support Implementation

**Phase**: 1 - Design & Contracts  
**Date**: 2024-12-19  
**Prerequisites**: research.md, data-model.md, contracts/

## Implementation Order

### Phase 1A: Core Infrastructure (Priority 1)

1. **Extend Type System** ⏱️ 1 hour
   ```bash
   # Add skill types to existing types.ts
   packages/agent-sdk/src/types.ts
   ```
   - Add simplified Skill-related interfaces from type-definitions.md
   - Maintain backward compatibility with existing types
   - Export new types for use in other modules

2. **Create Skill Parser** ⏱️ 2 hours  
   ```bash
   # Create dedicated skill parsing function
   packages/agent-sdk/src/utils/skillParser.ts
   ```
   - Add `parseSkillFile()` function (separate from markdown parser)
   - Add skill-specific validation logic
   - Focus only on SKILL.md files
   - Add comprehensive error handling

3. **Create SkillManager** ⏱️ 3 hours
   ```bash
   # New core skill management module
   packages/agent-sdk/src/managers/skillManager.ts
   ```
   - Implement skill discovery for personal and project directories
   - Simple in-memory storage (no complex caching)
   - Handle priority resolution (project over personal)
   - Minimal interface: initialize, getAvailableSkills, loadSkill

### Phase 1B: Tool Integration (Priority 1)

4. **Create Skill Tool** ⏱️ 4 hours
   ```bash
   # New tool plugin for skill invocation
   packages/agent-sdk/src/tools/skillTool.ts
   ```
   - Implement class-based ToolPlugin for dynamic description
   - Dynamic tool description and config based on available skills
   - Skill loading on-demand when AI invokes by name
   - Factory function for tool creation with skill manager dependency

5. **Update Tool Manager** ⏱️ 1 hour
   ```bash
   # Register Skill tool in existing manager
   packages/agent-sdk/src/managers/toolManager.ts
   ```
   - Create SkillManager instance during ToolManager construction
   - Register dynamic skill tool using factory function
   - Update getToolConfigurations() to include dynamic descriptions
   - No need to extend ToolContext - skill tool is self-contained

### Phase 1C: Testing Infrastructure (Priority 2)

6. **Unit Tests** ⏱️ 5 hours
   ```bash
   # Simplified test coverage
   packages/agent-sdk/tests/utils/skillParser.test.ts        # New
   packages/agent-sdk/tests/managers/skillManager.test.ts    # New
   packages/agent-sdk/tests/tools/skillTool.test.ts          # New
   ```
   - Mock file system operations
   - Test validation logic thoroughly
   - Test error handling scenarios
   - Test simple in-memory storage

7. **Integration Tests** ⏱️ 6 hours
   ```bash
   # Real file system tests with temporary directories
   packages/agent-sdk/tests/integration/skillTool.integration.test.ts
   ```
   - Create temporary directories for each test (mkdtemp)
   - Test end-to-end skill discovery and execution with real files
   - Test priority resolution (project over personal)
   - Test supporting file path resolution
   - Clean up temporary directories after each test

## Development Workflow

### Step 1: Environment Setup
```bash
# Navigate to agent-sdk package
cd packages/agent-sdk

# Ensure dependencies are installed
pnpm install

# Run existing tests to ensure baseline
pnpm test
```

### Step 2: Type System Extension
```typescript
// packages/agent-sdk/src/types.ts
// Add new interfaces at end of file to maintain compatibility

export interface SkillMetadata {
  name: string;
  description: string;
  type: 'personal' | 'project';
  skillPath: string;
}

export interface Skill extends SkillMetadata {
  content: string;
  frontmatter: SkillFrontmatter;
  isValid: boolean;
  errors: string[];
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  [key: string]: unknown;
}

export interface ISkillManager {
  initialize(): Promise<void>;
  getAvailableSkills(): SkillMetadata[];
  loadSkill(skillName: string): Promise<Skill | null>;
}

export interface SkillToolArgs {
  skill_name: string;
}

// No need to extend ToolContext - skill tool is self-contained
```

### Step 3: Skill Parser Implementation
```typescript
// packages/agent-sdk/src/utils/skillParser.ts
// New dedicated skill parsing module

export function parseSkillFile(filePath: string, options?: SkillParseOptions): ParsedSkillFile {
  // Parse YAML frontmatter specifically for skills
  // Validate skill-specific requirements
  // Return focused result for skill management
}
```

### Step 4: Manager Implementation
```typescript
// packages/agent-sdk/src/managers/skillManager.ts
// Simple skill management without complex caching

export class SkillManager implements ISkillManager {
  private personalSkills = new Map<string, SkillMetadata>();
  private projectSkills = new Map<string, SkillMetadata>();
  
  async initialize(): Promise<void> {
    // Discover skills in both directories
    // Store metadata in simple maps
    // No file watching or complex caching
  }

  getAvailableSkills(): SkillMetadata[] {
    // Return combined skills (project overrides personal)
  }

  async loadSkill(skillName: string): Promise<Skill | null> {
    // Load skill content on-demand
    // Parse and validate when requested
  }
}
```

### Step 5: Tool Implementation
```typescript
// packages/agent-sdk/src/tools/skillTool.ts
// Dynamic tool with class-based implementation for dynamic description

export class SkillTool implements ToolPlugin {
  name = "Skill";
  private skillManager: ISkillManager;

  constructor(skillManager: ISkillManager) {
    this.skillManager = skillManager;
  }

  // Dynamic description based on available skills
  get description(): string {
    const skills = this.skillManager.getAvailableSkills();
    
    if (skills.length === 0) {
      return "No skills currently available";
    }

    const skillList = skills
      .map(skill => `${skill.name}: ${skill.description}`)
      .join(', ');
    
    return `Invoke skills based on available skill metadata. Available skills: ${skillList}`;
  }

  // Dynamic config based on available skills
  get config(): any {
    const skills = this.skillManager.getAvailableSkills();
    const skillNames = skills.map(s => s.name);
    
    return {
      type: "function",
      function: {
        name: "Skill",
        description: "Invoke a skill to apply specialized expertise and capabilities",
        parameters: {
          type: "object",
          properties: {
            skill_name: {
              type: "string",
              description: `Name of the skill to invoke. Available: ${skillNames.join(', ')}`
            }
          },
          required: ["skill_name"],
          additionalProperties: false
        }
      }
    };
  }

  async execute(args: SkillToolArgs, context: ToolContext): Promise<ToolResult> {
    const { skill_name } = args;
    
    // Validate skill exists
    const availableSkills = this.skillManager.getAvailableSkills();
    const skillExists = availableSkills.some(s => s.name === skill_name);
    
    if (!skillExists) {
      const skillList = availableSkills
        .map(s => `- ${s.name}: ${s.description}`)
        .join('\n');
      
      return {
        success: false,
        error: `Skill '${skill_name}' not found.`,
        content: `Available skills:\n${skillList}`
      };
    }

    // Load skill content
    const skill = await this.skillManager.loadSkill(skill_name);
    
    if (!skill) {
      return {
        success: false,
        error: `Failed to load skill '${skill_name}'`,
        content: "The skill could not be loaded. Please check the skill file."
      };
    }

    // Return skill content with path context
    return {
      success: true,
      content: `Skill: ${skill.name} (Type: ${skill.type})\nPath: ${skill.skillPath}\n\n${skill.content}`,
      shortResult: `${skill.name}: ${skill.description}`
    };
  }
}

// Factory function to create the skill tool
export function createSkillTool(skillManager: ISkillManager): SkillTool {
  return new SkillTool(skillManager);
}
```

### Step 6: Integration
```typescript
// packages/agent-sdk/src/managers/toolManager.ts
// Simply register the skill tool without extending context

import { SkillManager } from "./skillManager.js";
import { createSkillTool } from "../tools/skillTool.js";

export interface ToolManagerOptions {
  mcpManager: McpManager;
  // No need to add skillManager here - tool creates its own
}

class ToolManager {
  private tools = new Map<string, ToolPlugin>();
  private mcpManager: McpManager;

  constructor(options: ToolManagerOptions) {
    this.mcpManager = options.mcpManager;
    
    // Register built-in tools
    this.registerBuiltInTools();
    
    // Create and register skill tool with its own skill manager
    const skillManager = new SkillManager();
    await skillManager.initialize(); // Initialize during construction
    const skillTool = createSkillTool(skillManager);
    this.tools.set(skillTool.name, skillTool);
  }

  // Method to get current tool configurations (called by AI system)
  async getToolConfigurations(): Promise<ChatCompletionFunctionTool[]> {
    const configs: ChatCompletionFunctionTool[] = [];
    
    // Add built-in tool configs (including dynamic skill tool)
    for (const tool of this.tools.values()) {
      configs.push(tool.config);
    }
    
    // Add MCP tool configs
    const mcpConfigs = await this.mcpManager.getToolConfigurations();
    configs.push(...mcpConfigs);
    
    return configs;
  }

  async execute(name: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    // No need to extend context - skill tool has its own skill manager
    // Standard execution logic
  }
}
```

## Testing Strategy

### Unit Test Coverage
- **Parser Tests**: YAML validation, error handling, edge cases
- **Manager Tests**: Discovery, simple storage, priority resolution  
- **Tool Tests**: Argument validation, skill loading, error responses
- **Type Tests**: Interface compliance, type safety validation

### Integration Test Scenarios
```typescript
// packages/agent-sdk/tests/integration/skillTool.integration.test.ts
// Use temporary directories for safe testing

import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Skill Tool Integration', () => {
  let tempDir: string;
  let personalSkillsDir: string;
  let projectSkillsDir: string;

  beforeEach(async () => {
    // Create temporary directory for each test
    tempDir = await mkdtemp(join(tmpdir(), 'wave-skills-test-'));
    personalSkillsDir = join(tempDir, '.wave', 'skills');
    projectSkillsDir = join(tempDir, 'project', '.wave', 'skills');
    
    // Create directory structure
    await mkdir(personalSkillsDir, { recursive: true });
    await mkdir(projectSkillsDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temporary directory
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('should discover skills from both personal and project directories', async () => {
    // Create test skills
    await createTestSkill(personalSkillsDir, 'personal-skill', 'A personal skill for testing');
    await createTestSkill(projectSkillsDir, 'project-skill', 'A project skill for testing');
    
    // Test skill discovery and execution
    // ...
  });

  test('should handle project skills overriding personal skills', async () => {
    // Create same-named skills in both directories
    await createTestSkill(personalSkillsDir, 'shared-skill', 'Personal version');
    await createTestSkill(projectSkillsDir, 'shared-skill', 'Project version');
    
    // Verify project skill takes priority
    // ...
  });

  test('should handle skills with supporting files', async () => {
    const skillDir = join(projectSkillsDir, 'skill-with-files');
    await mkdir(skillDir, { recursive: true });
    
    // Create SKILL.md
    await createTestSkill(projectSkillsDir, 'skill-with-files', 'Skill with supporting files');
    
    // Create supporting files
    await writeFile(join(skillDir, 'helper.py'), 'print("Helper script")');
    await writeFile(join(skillDir, 'reference.md'), '# Reference documentation');
    
    // Test that skill path is provided for relative resolution
    // ...
  });

  // Helper function to create test skills
  async function createTestSkill(baseDir: string, skillName: string, description: string) {
    const skillDir = join(baseDir, skillName);
    await mkdir(skillDir, { recursive: true });
    
    const skillContent = `---
name: ${skillName}
description: ${description}
---

# ${skillName}

This is a test skill for integration testing.

You can reference supporting files like:
- [Helper script](./helper.py)
- [Reference docs](./reference.md)
`;
    
    await writeFile(join(skillDir, 'SKILL.md'), skillContent);
  }
});
```

### Test Directory Structure (Temporary)
```
/tmp/wave-skills-test-{random}/
├── .wave/skills/                    # Personal skills (temporary)
│   ├── personal-skill/
│   │   └── SKILL.md
│   └── shared-skill/
│       └── SKILL.md
└── project/
    └── .wave/skills/               # Project skills (temporary)
        ├── project-skill/
        │   └── SKILL.md
        ├── shared-skill/
        │   └── SKILL.md
        └── skill-with-files/
            ├── SKILL.md
            ├── helper.py
            └── reference.md
```

### Performance Targets (Simplified)
- Skill discovery: < 500ms for 100 skills
- Individual skill loading: < 100ms
- Tool description generation: < 50ms

## Error Handling Implementation

### Validation Pipeline
1. **File System Check**: Directory exists, SKILL.md present
2. **YAML Parsing**: Valid frontmatter structure
3. **Metadata Validation**: Name format, description length
4. **Content Validation**: Markdown parseable

### User-Friendly Error Messages
```typescript
// Error message templates
const ERROR_MESSAGES = {
  SKILL_NOT_FOUND: (name: string, available: string[]) => 
    `Skill '${name}' not found.\n\nAvailable skills:\n${available.map(s => `- ${s}`).join('\n')}`,
  
  INVALID_NAME: (name: string) =>
    `Invalid skill name '${name}'. Use lowercase letters, numbers, and hyphens only (max 64 chars).`,
    
  MALFORMED_YAML: (path: string, error: string) =>
    `SKILL.md has invalid YAML frontmatter:\n${error}\n\nFix the frontmatter in ${path}`,
};
```

### Recovery Mechanisms (Simplified)
- **Skip invalid skills** - Continue discovery with other skills when one fails
- **Clear error messages** - Provide actionable error information in logs
- **Graceful fallback** - Tool remains functional even if no skills are found

## Quality Assurance

### Code Quality Gates
```bash
# Run after each implementation phase
pnpm run type-check    # TypeScript compilation
pnpm run lint          # ESLint rules
pnpm test              # Unit tests
pnpm run build         # Build verification
```

### Documentation Standards
- Comprehensive JSDoc comments for all public interfaces
- Clear error messages with actionable guidance
- Type annotations for all function parameters and returns

## Deployment Checklist

### Pre-merge Requirements
- [ ] All unit tests pass
- [ ] Integration tests pass with temporary directories
- [ ] TypeScript compilation without errors
- [ ] ESLint passes with no violations
- [ ] Performance targets met
- [ ] Error handling thoroughly tested
- [ ] Backward compatibility verified
- [ ] Temporary test directories properly cleaned up

### Post-merge Validation
- [ ] Skill discovery works with real directories
- [ ] Tool integration works with AI
- [ ] Error messages are user-friendly
- [ ] Performance meets requirements

## Rollback Strategy

### Safe Deployment Approach
1. **Feature Flag**: Disable skill tool if issues arise
2. **Fallback Mode**: Continue with existing tools only
3. **Error Isolation**: Skill errors don't affect other tools

## Estimated Timeline (Updated)

- **Phase 1A (Infrastructure)**: 6 hours over 1-2 days
- **Phase 1B (Tool Integration)**: 5 hours over 1-2 days  
- **Phase 1C (Testing)**: 11 hours over 2-3 days
- **Documentation & Polish**: 2 hours

**Total Estimated Effort**: 24 hours over 5-7 days

**Critical Path**: SkillManager → Dynamic Skill Tool → Integration → Testing

## Implementation Notes

### Dynamic Description Benefits
- **Always Current**: Tool description reflects real-time skill availability
- **AI Context**: Provides skill names and descriptions directly in tool description
- **No Caching Issues**: Generated fresh each time tools are requested
- **Self-Documenting**: AI sees exactly what skills are available

### Class-Based Tool Pattern
- **Dynamic Properties**: Use getters for description and config
- **Dependency Injection**: SkillManager injected via constructor
- **Factory Pattern**: Create tool instance with dependencies
- **Testability**: Easy to mock SkillManager for testing