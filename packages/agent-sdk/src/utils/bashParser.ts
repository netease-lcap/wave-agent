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
 * Registry of commands and their expected subcommand depth for smart prefix extraction.
 * For example, 'git: 2' means 'git commit' is a valid prefix, but 'git' alone is not.
 * Multi-word keys can be used for more specific rules.
 */
export interface ToolRule {
  depth: number;
  scopeFlags?: string[];
}

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
    scopeFlags: ["-C", "-c", "--directory", "--work-tree", "--git-dir"],
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
 * Extracts a "smart prefix" from a bash command based on common developer tools.
 * Returns null if the command is blacklisted or cannot be safely prefix-matched.
 */
export function getSmartPrefix(command: string): string | null {
  const parts = splitBashCommand(command);
  if (parts.length === 0) return null;

  // For now, we only support prefix matching for single commands or the first command in a chain
  // to keep it simple and safe.
  const firstCommand = parts[0];

  // Safety check: don't allow heredoc writes
  if (isBashHeredocWrite(firstCommand)) return null;

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
