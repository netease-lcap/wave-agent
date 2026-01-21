# Spec: Bash Tools

This specification covers the tools provided for executing shell commands. These tools allow the agent to interact with the terminal for tasks like running tests, managing git, or executing build scripts.

## Tools Overview

### 1. Bash Tool (`Bash`)
Executes a bash command in a persistent shell session.
- **Features**:
  - Supports both foreground and background execution.
  - Persistent shell session (though currently implemented via `spawn` with `shell: true` per call, it maintains the environment).
  - Optional timeout (default 120s for foreground).
  - Output truncation (max 30,000 characters).
  - Integration with `PermissionManager` for command safety.
  - Supports background execution via `run_in_background` parameter.

### 2. Bash Output Tool (`BashOutput`)
Retrieves output from a running or completed background bash shell.
- **Features**:
  - Uses a `bash_id` to identify the background process.
  - Supports filtering output lines using a regular expression.
  - Returns both `stdout` and `stderr`.

### 3. Kill Bash Tool (`KillBash`)
Kills a running background bash shell.
- **Features**:
  - Terminates the process group associated with the `shell_id`.

## Usage Guidelines
- **Specialized Tools First**: Agents are instructed to use specialized FS tools (Read, Write, etc.) instead of bash commands like `cat`, `ls`, or `grep` whenever possible.
- **Directory Verification**: Before creating files/directories via bash, agents should verify the parent directory exists.
- **Quoting**: File paths with spaces must be properly quoted.
- **Parallelism**: Independent commands should be run in parallel using multiple tool calls. Sequential dependent commands should be chained with `&&`.

## Security
The `Bash` tool is a high-risk tool and is subject to strict permission checks. It also includes logic to strip ANSI color codes from output to ensure readability for the LLM.
