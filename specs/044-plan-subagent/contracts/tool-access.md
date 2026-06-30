# API Contract: Plan Subagent Tool Access

**Purpose**: Define the tool access contract for Plan subagent to ensure read-only operation

## Tool Access Contract

### Allowed Tools

Plan subagent has access to the following read-only tools:

#### Glob
- **Purpose**: File pattern matching
- **Access Level**: Full
- **Restrictions**: None
- **Example Usage**: Find all TypeScript files: `**/*.ts`

#### Grep
- **Purpose**: Content search with regex
- **Access Level**: Full
- **Restrictions**: None
- **Example Usage**: Search for function definitions: `function\s+\w+`

#### Read
- **Purpose**: Reading file contents
- **Access Level**: Full
- **Restrictions**: None
- **Example Usage**: Read specific file for analysis

#### LSP (Language Server Protocol)
- **Purpose**: Code intelligence (definitions, references, symbols)
- **Access Level**: Full
- **Restrictions**: None
- **Example Usage**: Find all references to a function

#### Bash (Read-Only Commands)
- **Purpose**: System inspection and version control queries
- **Access Level**: Limited to read-only operations
- **Allowed Commands**:
  - `ls` - List directory contents
  - `git status` - Check git status
  - `git log` - View commit history
  - `git diff` - View file differences
  - `find` - Find files by criteria
  - `cat` - Display file contents
  - `head` - Display first lines of file
  - `tail` - Display last lines of file
- **Prohibited Commands**: See "Disallowed Tools" section

### Disallowed Tools

Plan subagent MUST NOT have access to the following tools:

#### Write
- **Reason**: Would allow creating new files, violating read-only constraint
- **Alternative**: None - planning phase is read-only

#### Edit
- **Reason**: Would allow modifying existing files, violating read-only constraint
- **Alternative**: None - planning phase is read-only

#### NotebookEdit
- **Reason**: Would allow modifying notebooks, violating read-only constraint
- **Alternative**: None - planning phase is read-only

#### Task
- **Reason**: Would allow spawning nested subagents, potentially causing confusion
- **Alternative**: None - Plan subagent should complete its work independently

#### Bash (Write Commands)
- **Prohibited Commands**:
  - `mkdir` - Create directories
  - `touch` - Create files
  - `rm` - Delete files
  - `cp` - Copy files
  - `mv` - Move files
  - `git add` - Stage changes
  - `git commit` - Commit changes
  - `npm install` - Install dependencies
  - `pip install` - Install dependencies
  - Any command using redirect operators (`>`, `>>`, `|`)
- **Reason**: Would modify system state, violating read-only constraint
- **Alternative**: System prompt provides clear guidance to use only read-only commands

## Runtime Enforcement

### Tool Filtering
- `SubagentManager` filters tools based on `tools` configuration
- Plan subagent receives only tools in allowed list
- Attempting to use disallowed tools results in "tool not found" error

### System Prompt Guidance
- System prompt includes critical section emphasizing read-only restrictions
- Explicitly lists prohibited operations
- Provides examples of allowed read-only operations

### Error Messages
When Plan subagent attempts prohibited operations:
- Clear error message: "Tool [name] is not available"
- Guidance to use read-only alternatives
- Reference to system prompt restrictions

## Validation

### Unit Tests
- Verify Plan subagent configuration includes only allowed tools
- Verify disallowed tools are not in tools array
- Verify system prompt includes read-only restrictions

### Integration Tests
- Attempt Write operation -> expect failure
- Attempt Edit operation -> expect failure
- Attempt read-only operations -> expect success
- Verify error messages are clear and helpful

## Contract Guarantees

1. Plan subagent WILL have access to Glob, Grep, Read, LSP, and read-only Bash commands
2. Plan subagent WILL NOT have access to Write, Edit, NotebookEdit, or Task tools
3. Plan subagent WILL receive clear error messages for prohibited operations
4. System WILL enforce tool restrictions at runtime via tool filtering
5. Tool configuration WILL be validated in unit tests
