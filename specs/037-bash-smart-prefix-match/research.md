# Research: Smart Prefix Match for Trusted Bash Commands

## Decision: Heuristic-based Smart Prefix Extraction

### Rationale
A heuristic-based approach is preferred over a full bash parser because it's simpler to implement, faster, and covers the most common developer use cases (package managers, git). It allows for a conservative approach where only known safe subcommands are included in the prefix.

### Heuristic Details
1. **Split & Clean**: Use `splitBashCommand` to handle multiple commands. For each command, strip environment variables and redirections.
2. **Sudo Handling**: If a command starts with `sudo`, strip it and process the rest. `sudo` itself will never be part of a prefix.
3. **Package Managers & Language Runtimes**:
   - **Node/JS**: `npm`, `pnpm`, `yarn`, `deno`, `bun`. Include subcommands like `install`, `add`, `test`, `run`, `build`.
   - **Python**: `python`, `python3`, `pip`, `pip3`, `poetry`, `conda`. Include subcommands like `install`, `run`, `test`, `add`.
   - **Java**: `java`, `javac`, `mvn`, `gradle`. Include subcommands for `mvn` and `gradle`.
   - **Rust**: `cargo`. Include subcommands like `build`, `test`, `run`, `add`, `check`.
   - **Go**: `go`. Include subcommands like `build`, `test`, `run`, `get`, `mod`.
4. **Version Control (git)**:
   - Include subcommands like `commit`, `push`, `pull`, `checkout`, `add`, `status`, `diff`.
5. **Containers & Infrastructure**:
   - **Docker**: `docker`, `docker-compose`. Include subcommands like `run`, `build`, `ps`, `exec`, `up`, `down`.
   - **Kubernetes**: `kubectl`. Include subcommands like `get`, `describe`, `apply`, `logs`.
6. **Blacklist**: Commands like `rm`, `mv`, `chmod`, `chown`, `sh`, `bash` will NEVER be prefix-matched. They will always require an exact match or manual approval.
7. **Fallback**: For unknown commands, the prefix is just the executable name (e.g., `ls`, `mkdir`).

## Decision: Storage Format in `settings.local.json`

### Rationale
The existing `PermissionManager` already supports a prefix matching syntax: `Bash(prefix:*)`. Leveraging this minimizes changes to the core permission checking logic.

### Format
- Exact match: `Bash(npm install lodash)`
- Prefix match: `Bash(npm install:*)`

## Decision: UI Integration in `Confirmation.tsx`

### Rationale
The user needs to see and potentially edit the suggested prefix to ensure security and correctness.

### Approach
1. When a bash command is prompted, calculate the suggested smart prefix.
2. Update the "Yes, and don't ask again" option text to show the prefix: `Yes, and don't ask again for: [prefix]`.
3. If the user selects this option, they can optionally edit the prefix before confirming (similar to how the "Alternative" option works).

## Alternatives Considered

### Full Bash Parser
- **Rejected because**: Overly complex for the requirement. We don't need to understand the full AST, just identify the command and subcommands.

### Regex-based Matching
- **Rejected because**: Hard to maintain and prone to errors with complex bash syntax (quotes, redirections, etc.). `splitBashCommand` already handles the hard parts.

### User-defined Regex Rules
- **Rejected because**: Too much friction for the user. The "smart" part should be automatic.
