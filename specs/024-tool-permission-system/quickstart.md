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
# CLI flag
wave --dangerously-skip-permissions

# Or set in settings.json
{
  "permissions": {
    "permissionMode": "bypassPermissions"
  }
}
```

### dontAsk Mode (Automated Workflows)
Auto-deny any restricted tool that isn't pre-approved. No user prompts will be shown.
```json
{
  "permissions": {
    "permissionMode": "dontAsk"
  }
}
```

## Mode Cycling

You can quickly switch between permission modes during a session using the `Shift+Tab` keyboard shortcut.

- **Cycle Order**: `default` -> `acceptEdits` -> `plan` -> `default`.
- **Bypass Mode**: `bypassPermissions` is only included in the cycle if the session was started with `--dangerously-skip-permissions` or `--permission-mode bypassPermissions`.
- **dontAsk Mode**: This mode is never included in the cycle to prevent accidental auto-denial of tools.

## Configuration (`settings.json`)

Wave supports three levels of configuration with proper precedence:
1. **CLI Flags** (`--dangerously-skip-permissions`)
2. **Local Project Config** (`.wave/settings.local.json`) 
3. **Project Config** (`.wave/settings.json`)
4. **User Config** (`~/.wave/settings.json`)

### Permission Mode
Set the default permission behavior for your project or globally.
```json
"permissions": {
  "permissionMode": "default" // "default" | "bypassPermissions" | "acceptEdits" | "plan" | "dontAsk"
}
```

### Safe Zone (Additional Directories)
Define extra directories where file operations are considered safe.
```json
"permissions": {
  "additionalDirectories": [
    "/path/to/my/other/project",
    "../shared-libs"
  ]
}
```

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
4. **MCP Tool**: `mcp__server__tool` (Format: `mcp__<server_name>__<tool_name>`)

## Interactive Trust

When Wave prompts for confirmation, you have several options to streamline your workflow:

### Auto-accepting Edits
When prompted for a file edit (e.g., `Write`), you will see an option:
**"Yes, and auto-accept edits"**
Selecting this will switch the session to `acceptEdits` mode, allowing all subsequent file edits in the current session without prompting, **provided they are within the Safe Zone**.

### Persisting Bash Commands
When prompted for a `Bash` command, you will see:
**"Yes, and don't ask again for this command in this workdir"**
Selecting this will save the command to `.wave/settings.local.json`. Future executions of the exact same command in this project will be automatically allowed.

### Smart Wildcard Matching
For common commands, Wave may suggest a wildcard pattern:
**"Yes, and don't ask again for: npm install *"**
This allows future similar commands (like `npm install express`) to execute without prompting.

## Safe Zone & Secure File Access
Wave enforces a "Safe Zone" for file modification operations (`Write`, `Edit`, `Delete`, and `mkdir` via `Bash`).
- **Safe Zone**: The union of the current working directory and any paths in `additionalDirectories`.
- **Auto-Accept**: If `acceptEdits` mode is enabled, file operations within the Safe Zone proceed automatically.
- **Security**: Any file operation **outside** the Safe Zone will **always** trigger a confirmation prompt, even if `acceptEdits` is enabled.
- **Symlinks**: The system resolves symbolic links to their real paths before checking against the Safe Zone.

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

## Programmatic and Session-specific Permissions

### CLI Session Permissions
You can provide temporary permission rules for a single `wave` session using the `--allowed-tools` and `--disallowed-tools` flags. These rules are not saved to your `settings.json`.

```bash
# Allow git status but disallow git push for this session
wave --allowed-tools "Bash(git status)" --disallowed-tools "Bash(git push*)"
```

### SDK Instance Permissions
When creating an `Agent` instance via the SDK, you can provide instance-specific permission rules.

```typescript
import { Agent } from 'wave-agent-sdk';

const agent = await Agent.create({
  // Allow specific patterns
  allowedTools: ["Bash(ls *)", "Read(src/**)"],
  // Explicitly block dangerous patterns
  disallowedTools: ["Bash(rm *)", "Write(.env)"]
});
```

## Agent SDK Integration

### Custom Permission Logic
```typescript
import { Agent, type PermissionDecision } from 'wave-agent-sdk';

const agent = await Agent.create({
  permissionMode: 'default',
  canUseTool: async (context): Promise<PermissionDecision> => {
    if (context.toolName === 'Bash') {
      return { behavior: 'deny', message: 'Bash execution not allowed' };
    }
    return { behavior: 'allow' };
  }
});
```
