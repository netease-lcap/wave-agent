# Custom Slash Commands - Developer Quickstart

**Feature**: Custom Slash Commands  
**Package**: agent-sdk + code  
**Generated**: December 19, 2024

## Overview

Custom slash commands allow users to create reusable AI workflow templates by placing markdown files in `.wave/commands/` directories. This guide covers implementation details, architecture patterns, and development workflows for the feature.

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   User Input    │    │  SlashCommand    │    │   AI Manager    │
│   "/command"    │───▶│    Manager       │───▶│   Execution     │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │  File System     │
                       │  .wave/commands/ │
                       │  *.md files      │
                       └──────────────────┘
```

**Key Components**:
- **SlashCommandManager** (agent-sdk): Core orchestration and command lifecycle
- **CommandSelector** (code): Interactive UI for command discovery
- **Parameter Parser**: Handles `$ARGUMENTS`, `$1`, `$2` substitution
- **File Discovery**: Scans project and user command directories

## Quick Implementation Guide

### 1. Core Manager Integration

```typescript
// In agent.ts - Initialize command manager
this.slashCommandManager = new SlashCommandManager({
  messageManager: this.messageManager,
  aiManager: this.aiManager,
  workdir: this.workdir,
  logger: this.logger
});

// Expose public API methods
public getSlashCommands(): SlashCommand[] {
  return this.slashCommandManager.getCommands();
}

public hasSlashCommand(commandId: string): boolean {
  return this.slashCommandManager.hasCommand(commandId);
}
```

### 2. Command Discovery Implementation

```typescript
// customCommands.ts - File system scanning
export function loadCustomSlashCommands(workdir: string): CustomSlashCommand[] {
  const projectCommands = scanCommandsDirectory(getProjectCommandsDir(workdir));
  const userCommands = scanCommandsDirectory(getUserCommandsDir());
  
  // Project commands take precedence
  const commandMap = new Map<string, CustomSlashCommand>();
  
  for (const command of userCommands) {
    commandMap.set(command.id, command);
  }
  
  for (const command of projectCommands) {
    commandMap.set(command.id, command);  // Overrides user commands
  }
  
  return Array.from(commandMap.values());
}
```

### 3. Parameter Substitution Engine

```typescript
// commandArgumentParser.ts - Template processing
export function substituteCommandParameters(content: string, argsString: string): string {
  const args = parseCommandArguments(argsString);
  let result = content;
  
  // Replace $ARGUMENTS with full argument string
  result = result.replace(/\$ARGUMENTS/g, argsString);
  
  // Replace positional parameters $1, $2, etc.
  const positionalParams = [...result.matchAll(/\$(\d+)/g)]
    .map(match => parseInt(match[1], 10))
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort((a, b) => b - a);  // Descending to avoid $10 -> $1 + "0"
    
  for (const paramNum of positionalParams) {
    const paramValue = args[paramNum - 1] || "";
    result = result.replace(new RegExp(`\\$${paramNum}`, "g"), paramValue);
  }
  
  return result;
}
```

### 4. UI Component Architecture

```typescript
// CommandSelector.tsx - Interactive command picker
export const CommandSelector: React.FC<CommandSelectorProps> = ({
  searchQuery,
  onSelect,
  onInsert,
  onCancel,
  commands = []
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  // Merge agent commands with built-in commands
  const allCommands = [...commands, ...AVAILABLE_COMMANDS];
  
  // Filter based on search query
  const filteredCommands = allCommands.filter(command =>
    !searchQuery || 
    command.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  useInput((input, key) => {
    if (key.return && filteredCommands[selectedIndex]) {
      onSelect(filteredCommands[selectedIndex].name);
    } else if (key.tab && onInsert && filteredCommands[selectedIndex]) {
      onInsert(filteredCommands[selectedIndex].name);
    } else if (key.escape) {
      onCancel();
    }
    // ... arrow key navigation
  });
};
```

## Development Patterns

### 1. Command File Format

```markdown
---
name: project-info
description: "Display current project information"  
model: gpt-4
allowedTools: [Read, Bash]
---

# Project Information Command

Please read the package.json file and display:
- Project name: $1 or auto-detect
- Version information
- Key dependencies

```bash
echo "Working directory: $(pwd)"
find . -name "package.json" -maxdepth 2
```

Additional context: $ARGUMENTS
```

### 2. Error Handling Patterns

```typescript
// Graceful degradation for command loading
private loadCustomCommands(): void {
  try {
    const customCommands = loadCustomSlashCommands(this.workdir);
    
    for (const command of customCommands) {
      try {
        // Process individual command
        this.registerCustomCommand(command);
      } catch (error) {
        // Skip bad command, continue with others
        this.logger?.warn(`Failed to load command ${command.id}:`, error);
      }
    }
    
    this.logger?.debug(`Loaded ${customCommands.length} custom commands`);
  } catch (error) {
    // System continues with built-in commands only
    this.logger?.warn("Failed to load custom commands:", error);
  }
}
```

### 3. Testing Strategies

```typescript
// Unit testing with mocks
describe("SlashCommandManager", () => {
  let manager: SlashCommandManager;
  let mockMessageManager: MessageManager;
  let mockAIManager: AIManager;
  
  beforeEach(() => {
    mockMessageManager = createMockMessageManager();
    mockAIManager = createMockAIManager();
    
    manager = new SlashCommandManager({
      messageManager: mockMessageManager,
      aiManager: mockAIManager,
      workdir: "/test/workdir"
    });
  });
  
  it("should parse slash command input correctly", () => {
    const result = manager.parseAndValidateSlashCommand("/test-command arg1 arg2");
    expect(result.isValid).toBe(true);
    expect(result.commandId).toBe("test-command");
    expect(result.args).toBe("arg1 arg2");
  });
});

// Integration testing with temporary directories
describe("Custom Command Loading", () => {
  let tempDir: string;
  
  beforeEach(async () => {
    tempDir = await createTempDirectory();
    await createTestCommandFile(tempDir, "test-command.md", "Test content");
  });
  
  afterEach(async () => {
    await cleanupTempDirectory(tempDir);
  });
  
  it("should load commands from project directory", () => {
    const commands = loadCustomSlashCommands(tempDir);
    expect(commands).toHaveLength(1);
    expect(commands[0].id).toBe("test-command");
  });
});
```

## Performance Considerations

### 1. Command Registry Optimization

```typescript
// Use Map for O(1) command lookup
private commands = new Map<string, SlashCommand>();
private customCommands = new Map<string, CustomSlashCommand>();

// Batch command loading to minimize file I/O
public reloadCustomCommands(): void {
  // Clear existing
  for (const commandId of this.customCommands.keys()) {
    this.commands.delete(commandId);
  }
  this.customCommands.clear();
  
  // Reload in batch
  this.loadCustomCommands();
}
```

### 2. Parameter Substitution Performance

```typescript
// Optimize by processing parameters in descending order
const positionalParams = [...content.matchAll(/\$(\d+)/g)]
  .map(match => parseInt(match[1], 10))
  .filter((value, index, array) => array.indexOf(value) === index)
  .sort((a, b) => b - a);  // Prevents $10 becoming $1 + "0"
```

### 3. UI Responsiveness

```typescript
// Debounce search input to prevent excessive filtering
const filteredCommands = useMemo(() => 
  allCommands.filter(command =>
    !searchQuery || 
    command.name.toLowerCase().includes(searchQuery.toLowerCase())
  ), 
  [allCommands, searchQuery]
);
```

## Integration Points

### 1. Agent SDK Integration

- **Initialization**: SlashCommandManager created during Agent constructor
- **Message Flow**: Commands execute in main agent context, not sub-agents
- **Tool Access**: Commands can restrict AI tools via `allowedTools` configuration
- **Error Handling**: Errors displayed in chat interface as error blocks

### 2. CLI UI Integration

- **Trigger**: `/` character in input box activates CommandSelector
- **Navigation**: Arrow keys, Enter to select, Tab to insert, Escape to cancel
- **Search**: Real-time filtering as user types after `/`
- **State Management**: React Context provides command list to UI components

### 3. File System Integration

- **Discovery**: Automatic scanning of `.wave/commands/` in project and user directories
- **Precedence**: Project-level commands override user-level commands with same name
- **Reloading**: API available for refreshing commands without restart

## Common Implementation Patterns

### 1. Bash Command Execution

```typescript
// Execute bash commands with timeout and error handling
private async executeBashCommands(content: string): Promise<string> {
  const { commands, processedContent } = parseBashCommands(content);
  const bashResults: BashCommandResult[] = [];
  
  for (const command of commands) {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.workdir,
        timeout: 30000  // 30 second timeout
      });
      bashResults.push({
        command,
        output: stdout || stderr || "",
        exitCode: 0
      });
    } catch (error) {
      // Handle timeout and execution errors
      bashResults.push({
        command,
        output: error.message || "",
        exitCode: 1
      });
    }
  }
  
  return replaceBashCommandsWithOutput(processedContent, bashResults);
}
```

### 2. Configuration Validation

```typescript
// Validate YAML frontmatter configuration
private validateCommandConfig(config: CustomSlashCommandConfig): boolean {
  if (config.allowedTools) {
    const availableTools = this.getAvailableTools();
    const invalidTools = config.allowedTools.filter(
      tool => !availableTools.includes(tool)
    );
    if (invalidTools.length > 0) {
      this.logger?.warn(`Invalid tools specified: ${invalidTools.join(", ")}`);
      return false;
    }
  }
  
  if (config.model && !this.isSupportedModel(config.model)) {
    this.logger?.warn(`Unsupported model: ${config.model}`);
    return false;
  }
  
  return true;
}
```

### 3. State Synchronization

```typescript
// Keep UI and command registry in sync
const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);

useEffect(() => {
  if (agentRef.current?.getSlashCommands) {
    const agentSlashCommands = agentRef.current.getSlashCommands();
    setSlashCommands(agentSlashCommands);
  }
}, [agent, messages]);  // Re-sync when agent changes or messages update
```

This quickstart provides the essential patterns and implementation details needed to understand, maintain, and extend the custom slash commands feature.