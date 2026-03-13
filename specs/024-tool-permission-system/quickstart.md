# Quick Start: Tool Permission System

This guide shows how to use the tool permission system in Wave.

## Basic Usage

### Default Safe Mode (Recommended)
By default, Wave prompts for confirmation before executing potentially dangerous operations. Common read-only `git` operations and safe utilities are automatically allowed.

```bash
# Normal mode - prompts for confirmation for restricted tools
wave
```

### Bypass Mode (Advanced Users)
Skip all permission checks for uninterrupted operation:
```bash
wave --dangerously-skip-permissions
```

## Configuration (`settings.json`)

### Allow Rules
Add rules to `permissions.allow` to permit specific actions without prompting.
```json
"permissions": {
  "allow": [
    "Bash(git commit *)",
    "Read(src/**)"
  ]
}
```

### Deny Rules
Add rules to `permissions.deny` to explicitly forbid actions. **Deny rules always take precedence over allow rules.**
```json
"permissions": {
  "deny": [
    "Bash(rm *)",
    "Read(**/.env)"
  ]
}
```

### Rule Formats
1. **Tool Name**: `Bash`, `Write`, `Read` (Allows all uses of the tool)
2. **Bash Command**: `Bash(ls -la)`, `Bash(git *)` (Supports `*` wildcards)
3. **Path-based**: `Read(**/*.env)`, `Write(/etc/**)` (Supports glob patterns)

## Smart Wildcard Matching
When Wave prompts for a bash command (e.g., `npm install lodash`), you can select:
**"Yes, and don't ask again for: npm install *"**

This will save a wildcard pattern to your settings, allowing future similar commands (like `npm install express`) to execute without prompting.

### Chained Commands
When you select "Don't ask again" for a chained command (e.g., `mkdir test && cd test`), Wave will split the chain and only save the non-safe parts (e.g., `Bash(mkdir test)`) to your allowed permissions list.

## Dangerous Command Safety
For security reasons, some commands will NOT show the "Don't ask again" option:
- **Dangerous Commands**: `rm`, `sudo`, `chmod`, `chown`, `mv`, `find`, `sed`.
- **Out-of-bounds Access**: Any command attempting to access paths outside the project root (e.g., `cd ..`, `ls /etc`).
- **Write Redirections**: Commands containing write redirections (e.g., `echo hi > file.txt`).

These operations must be authorized on a case-by-case basis.

## Secure Pipeline Validation
Wave automatically decomposes complex bash commands (using `&&`, `|`, `;`, etc.) and validates every individual command against your permission rules. If any part of the pipeline is not permitted, the entire command will require manual approval.

## Built-in Safe Commands
The following commands are automatically permitted if they operate within the current working directory or its subdirectories:
- **Safe Utilities**: `cd`, `ls`, `pwd`, `echo`, `which`, `hostname`, `date`.
- **Read-only Git**: `status`, `diff`, `log`, `show`, `branch`, `tag`, `remote`.

Any attempt to access paths outside the CWD (e.g., `cd ..`, `ls /etc`) will trigger a permission prompt.

## Agent SDK Integration

### Custom Permission Logic
```typescript
import { Agent, type PermissionDecision } from 'wave-agent-sdk';

const agent = await Agent.create({
  permissionMode: 'default',
  canUseTool: async (toolName: string): Promise<PermissionDecision> => {
    if (toolName === 'Bash') {
      return { behavior: 'deny', message: 'Bash execution not allowed' };
    }
    return { behavior: 'allow' };
  }
});
```
