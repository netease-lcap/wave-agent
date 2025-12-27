# Quickstart - Secure Pipeline Command Permission Matching

## Overview
This feature enhances the security of bash command execution by decomposing complex commands (pipelines, chained commands) and validating each part against the allowed permissions. It also introduces a built-in safe list for common commands like `cd`, `ls`, and `pwd` with workspace-aware path restrictions.

## Key Features
- **Command Decomposition**: Automatically splits `cmd1 && cmd2` into individual checks.
- **Safe List**: `cd`, `ls`, `pwd` are allowed by default within the project workspace.
- **Path Safety**: `cd ..` or `ls /etc` will require explicit permission even if the command is in the safe list.
- **Env Var Stripping**: `VAR=val cmd` is matched as `cmd`.

## Example Usage

### Automatically Permitted
- `cd src` (within workspace)
- `ls -la`
- `cd src && ls` (if both are safe)

### Requires Permission
- `cd ..` (outside workspace)
- `ls /etc` (outside workspace)
- `cd src && rm -rf /` (one part is unsafe)
