# Quickstart: Using Domain-Organized Types

**Feature**: 010-split-types-by-domain  
**Audience**: Developers using wave-agent-sdk  
**Purpose**: Guide for using the new domain-organized type system

## Overview

The wave-agent-sdk types are now organized into logical domains for better developer experience, cleaner imports, and improved tree-shaking. All existing code continues to work without changes.

## Import Patterns

### Option 1: Legacy Import (Backward Compatible)
```typescript
// ✅ Continues to work exactly as before
import { Message, ToolBlock, Logger, McpTool } from 'wave-agent-sdk/types';
```

### Option 2: Domain-Specific Import (Recommended)
```typescript
// ✅ New capability - import only what you need
import { Message, ToolBlock } from 'wave-agent-sdk/types/messaging';
import { Logger } from 'wave-agent-sdk/types/core';
import { McpTool } from 'wave-agent-sdk/types/mcp';
```

## Available Domains

### Core Types (`types/core`)
**What**: Foundational types used across domains  
**Use when**: You need basic types like Logger or error handling
```typescript
import { Logger, Usage, ConfigurationError } from 'wave-agent-sdk/types/core';
```

### Messaging (`types/messaging`)
**What**: Message and communication block types  
**Use when**: Working with agent messages, tool blocks, or conversation data
```typescript
import { 
  Message, 
  ToolBlock, 
  TextBlock, 
  MessageBlock 
} from 'wave-agent-sdk/types/messaging';
```

### MCP (`types/mcp`)
**What**: Model Context Protocol types  
**Use when**: Integrating with MCP servers or handling MCP configurations
```typescript
import { 
  McpServerConfig, 
  McpTool, 
  McpServerStatus 
} from 'wave-agent-sdk/types/mcp';
```

### Processes (`types/processes`)
**What**: Background process types  
**Use when**: Managing background shells or processes
```typescript
import { BackgroundShell } from 'wave-agent-sdk/types/processes';
```

### Commands (`types/commands`)
**What**: Slash command and custom command types  
**Use when**: Building or managing command systems
```typescript
import { 
  SlashCommand, 
  CustomSlashCommand 
} from 'wave-agent-sdk/types/commands';
```

### Skills (`types/skills`)
**What**: Skill system types and constants  
**Use when**: Working with skill metadata, validation, or management
```typescript
import { 
  Skill, 
  SkillMetadata, 
  SKILL_DEFAULTS 
} from 'wave-agent-sdk/types/skills';
```

### Configuration (`types/config`)
**What**: Agent and service configuration types  
**Use when**: Configuring gateway settings or model configurations
```typescript
import { 
  GatewayConfig, 
  ModelConfig 
} from 'wave-agent-sdk/types/config';
```

## Common Use Cases

### Building a Message Handler
```typescript
import { Message, ToolBlock, TextBlock } from 'wave-agent-sdk/types/messaging';
import { Logger } from 'wave-agent-sdk/types/core';

function handleMessage(message: Message, logger: Logger) {
  message.blocks.forEach(block => {
    if (block.type === 'tool') {
      const toolBlock = block as ToolBlock;
      logger.info(`Tool executed: ${toolBlock.name}`);
    }
  });
}
```

### Setting Up MCP Integration
```typescript
import { McpServerConfig, McpTool } from 'wave-agent-sdk/types/mcp';

const config: McpServerConfig = {
  command: 'mcp-server',
  args: ['--port', '3000'],
  env: { NODE_ENV: 'production' }
};

function processMcpTool(tool: McpTool) {
  console.log(`Available tool: ${tool.name}`);
}
```

### Working with Skills
```typescript
import { 
  Skill, 
  SkillValidationResult, 
  SKILL_DEFAULTS 
} from 'wave-agent-sdk/types/skills';

function validateSkill(skill: Skill): SkillValidationResult {
  const errors: string[] = [];
  
  if (skill.frontmatter.name.length > SKILL_DEFAULTS.MAX_NAME_LENGTH) {
    errors.push('Skill name too long');
  }
  
  return {
    isValid: errors.length === 0,
    skill: errors.length === 0 ? skill : undefined,
    errors
  };
}
```

### Agent Configuration
```typescript
import { GatewayConfig, ModelConfig } from 'wave-agent-sdk/types/config';
import { ConfigurationError } from 'wave-agent-sdk/types/core';

function createAgent(gateway: GatewayConfig, model: ModelConfig) {
  if (!gateway.apiKey) {
    throw new ConfigurationError('Missing API key', 'apiKey');
  }
  
  // Configure agent with validated settings
}
```

## Migration Guide

### No Migration Required
- All existing imports continue to work
- No breaking changes to type definitions
- No code changes needed immediately

### Gradual Migration (Optional)
1. **Start with new features**: Use domain imports for new code
2. **Refactor incrementally**: Update imports when modifying existing files
3. **Target tree-shaking**: Use domain imports for better bundle optimization

### Before (Legacy Pattern)
```typescript
import { 
  Message, 
  ToolBlock, 
  Logger, 
  McpTool, 
  Skill 
} from 'wave-agent-sdk/types';
```

### After (Domain Pattern)
```typescript
import { Message, ToolBlock } from 'wave-agent-sdk/types/messaging';
import { Logger } from 'wave-agent-sdk/types/core';
import { McpTool } from 'wave-agent-sdk/types/mcp';
import { Skill } from 'wave-agent-sdk/types/skills';
```

## Benefits

### 🎯 **Targeted Imports**
Import only the types you need, reducing cognitive load and potential bundle size.

### 🌳 **Better Tree-Shaking**
Bundlers can more effectively eliminate unused types with domain-specific imports.

### 📋 **Improved Discoverability**
Domain names make it clear which types are related to specific functionality.

### 🔧 **Maintainability**
Organized types are easier to find, understand, and maintain.

### 🔄 **Backward Compatibility**
Existing code works unchanged while new features benefit from organization.

## IDE Support

Most TypeScript-aware IDEs will provide improved autocomplete and suggestions:

```typescript
// Typing 'wave-agent-sdk/types/' will show available domains:
import { } from 'wave-agent-sdk/types/|'
//                                    ↳ messaging, mcp, core, skills, etc.
```

## Best Practices

1. **Use domain imports for new code** to benefit from organization
2. **Import from core for shared types** like Logger and Usage
3. **Prefer specific imports over wildcard imports** for better tree-shaking
4. **Group related imports together** by domain for readability

The domain-organized types provide a foundation for scalable TypeScript development while maintaining full backward compatibility with existing code.