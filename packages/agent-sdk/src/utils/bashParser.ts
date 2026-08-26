/**
 * Splits a complex bash command into individual simple commands by shell operators (&&, ||, ;, |, &).
 * Correctly handles quotes, escaped characters, and subshells.
 */
export function splitBashCommand(command: string): string[] {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  let parenLevel = 0;
  const splitPositions: number[] = [];

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    const nextChar = command[i + 1];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === "(") {
      parenLevel++;
      continue;
    }

    if (char === ")") {
      parenLevel--;
      continue;
    }

    if (parenLevel > 0) {
      continue;
    }

    // Check for operators
    let opLen = 0;
    if (char === "&" && nextChar === "&") opLen = 2;
    else if (char === "|" && nextChar === "|") opLen = 2;
    else if (char === "|" && nextChar === "&") opLen = 2;
    else if (char === ";") opLen = 1;
    else if (char === "|") opLen = 1;
    else if (char === "&" && nextChar !== ">" && command[i - 1] !== ">")
      opLen = 1;

    if (opLen > 0) {
      // Check if preceded by an odd number of backslashes
      let backslashCount = 0;
      for (let j = i - 1; j >= 0; j--) {
        if (command[j] === "\\") backslashCount++;
        else break;
      }

      // ALSO check if preceded by an escaped operator character (e.g., \&&)
      let precededByEscapedOp = false;
      if (i > 0 && /[&|;]/.test(command[i - 1])) {
        let bsCount = 0;
        for (let j = i - 2; j >= 0; j--) {
          if (command[j] === "\\") bsCount++;
          else break;
        }
        if (bsCount % 2 !== 0) precededByEscapedOp = true;
      }

      if (backslashCount % 2 === 0 && !precededByEscapedOp) {
        splitPositions.push(i, i + opLen);
        i += opLen - 1;
      }
    }
  }

  let lastPos = 0;
  const parts: string[] = [];
  for (let i = 0; i < splitPositions.length; i += 2) {
    const start = splitPositions[i];
    const end = splitPositions[i + 1];
    const part = command.substring(lastPos, start).trim();
    if (part) parts.push(part);
    lastPos = end;
  }
  const lastPart = command.substring(lastPos).trim();
  if (lastPart) parts.push(lastPart);

  const finalResult: string[] = [];
  for (const part of parts) {
    const envStripped = stripEnvVars(part);
    const stripped = stripRedirections(envStripped);
    if (
      stripped.startsWith("(") &&
      stripped.endsWith(")") &&
      stripped === envStripped
    ) {
      const inner = stripped.substring(1, stripped.length - 1).trim();
      if (inner) {
        finalResult.push(...splitBashCommand(inner));
      }
    } else {
      finalResult.push(part);
    }
  }

  return finalResult;
}

/**
 * Removes inline environment variable assignments (e.g., VAR=val cmd -> cmd).
 */
export function stripEnvVars(command: string): string {
  let result = command.trim();
  while (true) {
    const match = result.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=/);
    if (!match) break;

    const varNameEnd = match[0].length;
    let valueEnd = varNameEnd;

    if (result[varNameEnd] === "'") {
      valueEnd = result.indexOf("'", varNameEnd + 1);
      if (valueEnd === -1) break;
      valueEnd++;
    } else if (result[varNameEnd] === '"') {
      let escaped = false;
      let found = false;
      for (let i = varNameEnd + 1; i < result.length; i++) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (result[i] === "\\") {
          escaped = true;
          continue;
        }
        if (result[i] === '"') {
          valueEnd = i + 1;
          found = true;
          break;
        }
      }
      if (!found) break;
    } else {
      const spaceIndex = result.search(/\s/);
      if (spaceIndex === -1) {
        return "";
      }
      valueEnd = spaceIndex;
    }

    result = result.substring(valueEnd).trim();
  }
  return result;
}

/**
 * Removes redirections (e.g., echo "data" > output.txt -> echo "data").
 */
export function stripRedirections(command: string): string {
  let result = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      result += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      result += char;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      result += char;
      continue;
    }

    // Handle whitespace outside quotes: collapse multiple spaces into one
    if (/\s/.test(char)) {
      if (result.length > 0 && !/\s/.test(result[result.length - 1])) {
        result += " ";
      }
      continue;
    }

    // Check for redirection
    if (char === ">" || char === "<") {
      // Check if preceded by a digit or & (for 2> or &>)
      if (result.length > 0 && /[0-9&]/.test(result[result.length - 1])) {
        // Ensure it's at the start of a word or preceded by whitespace
        if (result.length === 1 || /\s/.test(result[result.length - 2])) {
          // Remove the digit/& from result
          result = result.substring(0, result.length - 1);
        }
      }

      let end = i + 1;
      if (command[end] === char) {
        end++;
        if (char === "<" && command[end] === "-") {
          end++;
        }
      } else if (
        command[end] === "&" ||
        (char === ">" && command[end] === "|")
      ) {
        end++;
      }

      // Skip whitespace after operator
      while (end < command.length && /\s/.test(command[end])) {
        end++;
      }

      // Skip the following word (the target of redirection)
      let wordEscaped = false;
      let wordInSingleQuote = false;
      let wordInDoubleQuote = false;
      while (end < command.length) {
        const c = command[end];
        if (wordEscaped) {
          wordEscaped = false;
          end++;
          continue;
        }
        if (c === "\\") {
          wordEscaped = true;
          end++;
          continue;
        }
        if (c === "'" && !wordInDoubleQuote) {
          wordInSingleQuote = !wordInSingleQuote;
          end++;
          continue;
        }
        if (c === '"' && !wordInSingleQuote) {
          wordInDoubleQuote = !wordInDoubleQuote;
          end++;
          continue;
        }
        if (!wordInSingleQuote && !wordInDoubleQuote && /\s/.test(c)) {
          break;
        }
        end++;
      }

      i = end - 1;
      // After stripping a redirection, ensure there's a space if we're not at the end
      if (result.length > 0 && !/\s/.test(result[result.length - 1])) {
        result += " ";
      }
      continue;
    }

    result += char;
  }

  return result.trim();
}

/**
 * Checks if a bash command contains any write redirections (>, >>, &>, 2>, >|).
 */
export function hasWriteRedirections(command: string): boolean {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === ">") {
      // Check if this is a redirection to /dev/null
      let j = i + 1;
      // Handle >> or >|
      if (j < command.length && (command[j] === ">" || command[j] === "|")) {
        j++;
      }

      // Skip whitespace after operator
      while (j < command.length && /\s/.test(command[j])) {
        j++;
      }

      // Extract the target word, handling quotes and escapes
      let target = "";
      let targetEscaped = false;
      let targetInSingleQuote = false;
      let targetInDoubleQuote = false;
      let k = j;
      while (k < command.length) {
        const c = command[k];
        if (targetEscaped) {
          targetEscaped = false;
          target += c;
          k++;
          continue;
        }
        if (c === "\\") {
          targetEscaped = true;
          k++;
          continue;
        }
        if (c === "'" && !targetInDoubleQuote) {
          targetInSingleQuote = !targetInSingleQuote;
          k++;
          continue;
        }
        if (c === '"' && !targetInSingleQuote) {
          targetInDoubleQuote = !targetInDoubleQuote;
          k++;
          continue;
        }
        if (!targetInSingleQuote && !targetInDoubleQuote && /\s/.test(c)) {
          break;
        }
        target += c;
        k++;
      }

      // If the target is exactly /dev/null, we ignore this redirection
      if (target === "/dev/null") {
        i = k - 1; // Move the main loop index to the end of the target
        continue;
      }

      // Ignore file descriptor redirections like 2>&1, >&2, etc.
      if (target.startsWith("&") && /^\d+$/.test(target.substring(1))) {
        i = k - 1;
        continue;
      }

      return true;
    }
  }

  return false;
}

/**
 * Checks if a bash command contains any heredocs (<<, <<-).
 */
export function hasHeredoc(command: string): boolean {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === "<" && command[i + 1] === "<") {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a bash command is a heredoc write operation (e.g., cat <<EOF > file).
 */
export function isBashHeredocWrite(command: string): boolean {
  return hasHeredoc(command) && hasWriteRedirections(command);
}

/**
 * Blacklist of dangerous commands that should not be safely prefix-matched
 * and should not have persistent permissions.
 */
export const DANGEROUS_COMMANDS = [
  "rm",
  "mv",
  "chmod",
  "chown",
  "sh",
  "bash",
  "zsh",
  "fish",
  "pwsh",
  "cmd.exe",
  "powershell.exe",
  "sudo",
  "dd",
  "apt",
  "apt-get",
  "yum",
  "dnf",
  "ssh",
  "scp",
  "sftp",
  "ftp",
  "telnet",
  "nc",
  "netcat",
];

/**
 * Read-only command set: commands that only read/transform data and write to stdout.
 * When a command in this set is used without write redirections, command substitution,
 * or dangerous flags (e.g. sed -i), it is auto-allowed without a confirmation dialog.
 * Aligned with Claude Code's SEMANTIC_READ_ONLY_COMMANDS, excluding interactive pagers
 * (less, more, man, info), command executors (xargs), and infinite-output generators (yes).
 * FR-019.2 through FR-019.7 in tool-permission-system.md.
 */
export const READ_ONLY_COMMANDS = [
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "sort",
  "uniq",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "find",
  "which",
  "whereis",
  "file",
  "stat",
  "du",
  "df",
  "free",
  "uptime",
  "uname",
  "hostname",
  "whoami",
  "id",
  "groups",
  "env",
  "printenv",
  "echo",
  "printf",
  "date",
  "true",
  "false",
  "pwd",
  "tree",
  "diff",
  "cmp",
  "md5sum",
  "sha256sum",
  "sha1sum",
  "xxd",
  "od",
  "hexdump",
  "strings",
  "readlink",
  "realpath",
  "basename",
  "dirname",
  "seq",
  "column",
  "jq",
  "yq",
  "cut",
  "paste",
  "tr",
  "awk",
  "sed",
  "test",
  "expr",
  "bc",
  "sleep",
];

/**
 * Subset of READ_ONLY_COMMANDS whose arguments are file paths (as opposed to
 * strings, names, or flags, e.g. echo, pwd, which, basename). These commands
 * must stay within the Safe Zone: a read-only command accessing a path outside
 * the working directory / additional directories requires confirmation.
 * Aligned with Claude Code's PathCommand list.
 */
export const PATH_COMMANDS = [
  "ls",
  "find",
  "cat",
  "head",
  "tail",
  "wc",
  "sort",
  "uniq",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "file",
  "stat",
  "du",
  "df",
  "tree",
  "diff",
  "cmp",
  "md5sum",
  "sha256sum",
  "sha1sum",
  "xxd",
  "od",
  "hexdump",
  "strings",
  "readlink",
  "realpath",
  "jq",
  "yq",
  "cut",
  "paste",
  "column",
  "tr",
  "awk",
  "sed",
];

/**
 * Extract file path arguments from a command's argument string.
 * Tokens starting with "-" are treated as flags and skipped; everything after
 * a "--" separator counts as a path. Quoted path arguments are unquoted.
 * Non-path tokens (e.g. a grep pattern) are harmless: they resolve against the
 * working directory and typically do not exist, so isPathInside falls back to
 * the nearest existing parent (the workdir itself) and stays inside.
 */
export function extractPathArgs(args: string): string[] {
  const tokens = args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const pathArgs: string[] = [];
  let afterDoubleDash = false;
  for (const token of tokens) {
    if (afterDoubleDash) {
      pathArgs.push(token);
      continue;
    }
    if (token === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!token.startsWith("-")) {
      pathArgs.push(token);
    }
  }
  return pathArgs.map((p) => p.replace(/^['"](.*)['"]$/, "$1"));
}

/**
 * Registry of commands and their expected subcommand depth for smart prefix extraction.
 * For example, 'git: 2' means 'git commit' is a valid prefix, but 'git' alone is not.
 * Multi-word keys can be used for more specific rules.
 */
export interface ToolRule {
  depth: number;
  scopeFlags?: string[];
}

/**
 * Global scope flags for git that only change the target repository or
 * configuration, not the subcommand being run. Shared by TOOL_RULES (smart
 * prefix extraction) and stripGitScopePrefix (rule matching).
 */
export const GIT_SCOPE_FLAGS = [
  "-C",
  "-c",
  "--directory",
  "--work-tree",
  "--git-dir",
];

export const TOOL_RULES: Record<string, ToolRule> = {
  // Node/JS
  npm: { depth: 2, scopeFlags: ["--prefix", "-C", "--registry"] },
  "npm run": { depth: 3, scopeFlags: ["--prefix", "-C", "--registry"] },
  pnpm: { depth: 2, scopeFlags: ["-C", "--dir", "-F", "--filter"] },
  "pnpm run": { depth: 3, scopeFlags: ["-C", "--dir", "-F", "--filter"] },
  yarn: { depth: 2, scopeFlags: ["workspace", "--cwd"] },
  "yarn run": { depth: 3, scopeFlags: ["workspace", "--cwd"] },
  "yarn workspace": { depth: 4, scopeFlags: ["--cwd"] },
  bun: { depth: 2 },
  "bun run": { depth: 3 },
  deno: { depth: 2 },
  "deno run": { depth: 3 },
  "deno task": { depth: 3 },

  // Git
  git: {
    depth: 2,
    scopeFlags: GIT_SCOPE_FLAGS,
  },

  // Python
  python: { depth: 2 },
  python3: { depth: 2 },
  "python -m": { depth: 2 },
  "python3 -m": { depth: 2 },
  "python -m pip install": { depth: 3 },
  "python3 -m pip install": { depth: 3 },
  pip: { depth: 2 },
  pip3: { depth: 2 },
  poetry: { depth: 2 },
  conda: { depth: 2 },

  // Java
  mvn: { depth: 2 },
  gradle: { depth: 2 },
  java: { depth: 1 },
  "java -jar": { depth: 1 },

  // Rust & Go
  cargo: { depth: 2 },
  go: { depth: 2 },

  // Containers & Infrastructure
  docker: { depth: 2 },
  "docker-compose": { depth: 2 },
  kubectl: { depth: 2 },
  terraform: { depth: 2 },
  gcloud: { depth: 2 },
  "gcloud compute": { depth: 4 },
  "gcloud container": { depth: 4 },
  aws: { depth: 2 },
};

/**
 * Registry of dangerous subcommands for specific tools.
 */
export const DANGEROUS_SUBCOMMANDS: Record<string, string[]> = {
  docker: ["rm", "rmi", "system", "volume", "network", "image", "container"],
  git: ["reset", "clean"],
  npm: ["uninstall", "un", "remove", "rm"],
  pnpm: ["uninstall", "un", "remove", "rm"],
  yarn: ["remove"],
  deno: ["uninstall"],
  bun: ["remove", "rm"],
};

/**
 * Heuristic to determine if a flag takes an argument.
 * If nextArg doesn't start with '-' and isn't a known subcommand, assume it's a flag value.
 */
function flagTakesArg(flag: string, nextArg: string | undefined): boolean {
  if (!nextArg) return false;
  if (nextArg.startsWith("-")) return false;
  // If it's a common subcommand, it's probably not a flag argument
  const commonSubcommands = [
    "install",
    "add",
    "remove",
    "run",
    "test",
    "build",
    "status",
    "diff",
    "commit",
    "push",
    "pull",
    "checkout",
    "log",
    "fetch",
    "merge",
    "rebase",
  ];
  if (commonSubcommands.includes(nextArg)) return false;
  return true;
}

/**
 * Detects if an argument is a file path or URL.
 */
function shouldStopAtArg(arg: string): boolean {
  if (!arg) return false;
  // URLs
  if (/^(https?|ftp|ssh|git):\/\//.test(arg)) return true;
  // File paths (starts with /, ./, ../, or ~/)
  if (
    arg.startsWith("/") ||
    arg.startsWith("./") ||
    arg.startsWith("../") ||
    arg.startsWith("~/")
  )
    return true;
  // Common file extensions (but not scoped packages or common subcommands)
  if (
    /\.(ts|js|py|sh|md|txt|json|yml|yaml|html|css|go|rs|java|cpp|c|h|php|rb|pl|sql)$/.test(
      arg,
    ) &&
    !arg.includes("@") &&
    !arg.includes("/")
  )
    return true;
  return false;
}

/**
 * Checks if a find command is dangerous (e.g., contains -exec, -delete, etc.).
 */
export function isDangerousFind(command: string): boolean {
  const stripped = stripRedirections(stripEnvVars(command));
  const tokens = stripped.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  if (tokens.length === 0 || tokens[0] !== "find") return false;

  const dangerousFlags = [
    "-exec",
    "-execdir",
    "-ok",
    "-okdir",
    "-delete",
    "-fprint",
    "-fprint0",
    "-fprintf",
  ];
  return tokens.some((token) => {
    const unquoted = token.replace(/^(['"])(.*)\1$/, "$2");
    return dangerousFlags.includes(unquoted);
  });
}

/**
 * Detects command substitution $(...) or backticks `...` in a command string.
 * Commands with substitution are never auto-allowed because the substituted
 * command may be dangerous (e.g. cat $(rm x)). FR-019.6.
 */
export function hasCommandSubstitution(command: string): boolean {
  // Remove quoted strings first so $() or backticks inside quotes don't trigger
  const stripped = command
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  return /\$\([^)]*\)/.test(stripped) || /`[^`]*`/.test(stripped);
}

/**
 * Detects process substitution <(...) or >(...) in a command string.
 * These can execute side effects and are never auto-allowed. FR-019.6.
 */
export function hasProcessSubstitution(command: string): boolean {
  const stripped = command
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  return /[<>]\([^)]*\)/.test(stripped);
}

/**
 * Detects sed in-place edit flag (-i, with optional backup suffix like -i.bak).
 * sed -i modifies files in place and must NOT be auto-allowed. FR-019.5.
 */
export function hasSedInPlace(command: string): boolean {
  const stripped = stripRedirections(stripEnvVars(command));
  const tokens = stripped.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  if (tokens.length === 0 || tokens[0] !== "sed") return false;
  return tokens.some((token) => /^-i(\..*)?$/.test(token));
}

/**
 * Removes leading git global scope flags (e.g. `git -C <path>`, `git -c <key>=<value>`,
 * `git --git-dir <path>`) from a command string, so that `git -C /tmp/foo status` is
 * classified the same as `git status`. Only the leading sequence before the git
 * subcommand is stripped; the remainder is re-joined with single spaces.
 * Returns the input unchanged when nothing is stripped.
 */
export function stripGitScopePrefix(command: string): string {
  const trimmed = command.trim();
  if (!/^git(?:\s|$)/.test(trimmed)) return command;

  const tokens = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  if (tokens.length === 0 || tokens[0] !== "git") return command;

  let i = 1;
  while (i < tokens.length) {
    const token = tokens[i];
    const eqIndex = token.indexOf("=");
    const flag = eqIndex > 0 ? token.slice(0, eqIndex) : token;
    if (!GIT_SCOPE_FLAGS.includes(flag)) break;
    if (eqIndex > 0) {
      i++; // --flag=value form carries its own value
    } else {
      i += 2; // skip the flag and its argument
    }
  }

  if (i === 1) return command;
  return ["git", ...tokens.slice(i)].join(" ");
}

/**
 * Extracts a "smart prefix" from a bash command based on common developer tools.
 * Returns null if the command is blacklisted or cannot be safely prefix-matched.
 */
export function getSmartPrefix(command: string): string | null {
  const parts = splitBashCommand(command);
  if (parts.length === 0) return null;

  // For now, we only support prefix matching for single commands or the first command in a chain
  // to keep it simple and safe.
  const firstCommand = parts[0];

  const stripped = stripRedirections(stripEnvVars(firstCommand));
  const tokens = stripped.split(/\s+/);
  if (tokens.length === 0) return null;

  const prefixParts: string[] = [];
  let i = 0;

  // Handle prefix tools like sudo
  const prefixTools = ["sudo", "time", "stdbuf", "timeout"];
  while (i < tokens.length && prefixTools.includes(tokens[i])) {
    prefixParts.push(tokens[i]);
    i++;
  }

  if (i >= tokens.length) return null;

  const exe = tokens[i];
  // Blacklist - Hard blacklist for dangerous commands
  if (DANGEROUS_COMMANDS.includes(exe)) return null;

  // Find the longest matching rule in TOOL_RULES
  let bestRuleKey = "";
  let rule: ToolRule | undefined;

  for (const [key, r] of Object.entries(TOOL_RULES)) {
    const keyTokens = key.split(/\s+/);
    let match = true;
    for (let j = 0; j < keyTokens.length; j++) {
      if (tokens[i + j] !== keyTokens[j]) {
        match = false;
        break;
      }
    }
    if (match && key.length > bestRuleKey.length) {
      bestRuleKey = key;
      rule = r;
    }
  }

  // If no rule found, we don't suggest a prefix
  if (!rule) return null;

  const depth = rule.depth;
  const scopeFlags = rule.scopeFlags || [];
  let currentDepth = 0;

  // Safety check: only allow safe subcommands for git
  const safeGitSubcommands = [
    "commit",
    "push",
    "pull",
    "checkout",
    "add",
    "status",
    "diff",
    "branch",
    "merge",
    "rebase",
    "log",
    "fetch",
    "remote",
    "stash",
  ];

  const destructiveGitFlags = [
    "-d",
    "-D",
    "--delete",
    "--hard",
    "--force",
    "-f",
  ];

  // Global safety check: scan ALL tokens for dangerous flags/subcommands
  for (let j = i; j < tokens.length; j++) {
    const token = tokens[j];
    if (token.startsWith("-")) {
      if (exe === "git" && destructiveGitFlags.includes(token)) return null;
    } else {
      if (DANGEROUS_SUBCOMMANDS[exe]?.includes(token)) return null;
    }
  }

  // Include all tokens from the best matching rule
  const ruleTokens = bestRuleKey.split(/\s+/);
  for (let j = 0; j < ruleTokens.length; j++) {
    const token = tokens[i];
    if (!token) break;

    if (token.startsWith("-")) {
      if (exe === "git" && destructiveGitFlags.includes(token)) return null;
    } else {
      if (DANGEROUS_SUBCOMMANDS[exe]?.includes(token)) return null;
      if (
        exe === "git" &&
        currentDepth > 0 &&
        !safeGitSubcommands.includes(token)
      ) {
        return null;
      }
      currentDepth++;
    }

    prefixParts.push(token);
    i++;
  }

  // Continue until we reach the required depth
  while (i < tokens.length && currentDepth < depth) {
    const token = tokens[i];

    if (token.startsWith("-")) {
      // Safety checks for flags
      if (exe === "git" && destructiveGitFlags.includes(token)) return null;

      prefixParts.push(token);
      if (scopeFlags.includes(token) || flagTakesArg(token, tokens[i + 1])) {
        if (i + 1 < tokens.length) {
          prefixParts.push(tokens[++i]);
        }
      }
    } else {
      // Safety checks for subcommands
      if (DANGEROUS_SUBCOMMANDS[exe]?.includes(token)) return null;
      if (
        exe === "git" &&
        currentDepth > 0 &&
        !safeGitSubcommands.includes(token)
      ) {
        return null;
      }

      // Stop at data/paths
      if (shouldStopAtArg(token) && currentDepth > 0) break;

      prefixParts.push(token);
      currentDepth++;
    }
    i++;
  }

  if (currentDepth < depth) return null;

  return prefixParts.join(" ");
}
