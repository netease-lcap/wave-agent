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
    else if (char === "&" && nextChar !== ">") opLen = 1;

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
    const stripped = stripRedirections(stripEnvVars(part));
    if (stripped.startsWith("(") && stripped.endsWith(")")) {
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
  "sudo",
  "dd",
  "apt",
  "apt-get",
  "yum",
  "dnf",
];

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
  let stripped = stripRedirections(stripEnvVars(firstCommand));

  // Handle sudo
  if (stripped.startsWith("sudo ")) {
    stripped = stripped.substring(5).trim();
  }

  const tokens = stripped.split(/\s+/);
  if (tokens.length === 0) return null;

  const exe = tokens[0];
  const sub = tokens[1];

  // Blacklist - Hard blacklist for dangerous commands
  if (DANGEROUS_COMMANDS.includes(exe)) return null;

  // Node/JS
  if (["npm", "pnpm", "yarn", "deno", "bun"].includes(exe)) {
    if (
      [
        "install",
        "i",
        "add",
        "remove",
        "test",
        "t",
        "build",
        "start",
        "dev",
      ].includes(sub)
    ) {
      return `${exe} ${sub}`;
    }
    if (sub === "run" && tokens[2]) {
      return `${exe} run ${tokens[2]}`;
    }
    return exe;
  }

  // Git
  if (exe === "git") {
    if (
      [
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
      ].includes(sub)
    ) {
      return `${exe} ${sub}`;
    }
    return exe;
  }

  // Python
  if (["python", "python3", "pip", "pip3", "poetry", "conda"].includes(exe)) {
    if (exe === "python" || exe === "python3") {
      if (sub === "-m" && tokens[2] === "pip" && tokens[3] === "install") {
        return `${exe} -m pip install`;
      }
      return exe;
    }
    if (["install", "add", "remove", "test", "run"].includes(sub)) {
      return `${exe} ${sub}`;
    }
    return exe;
  }

  // Java
  if (["mvn", "gradle"].includes(exe)) {
    if (sub && !sub.startsWith("-")) {
      return `${exe} ${sub}`;
    }
    return exe;
  }
  if (exe === "java") {
    if (sub === "-jar") return "java -jar";
    return "java";
  }

  // Rust & Go
  if (exe === "cargo") {
    if (["build", "test", "run", "add", "check"].includes(sub)) {
      return `${exe} ${sub}`;
    }
    return exe;
  }
  if (exe === "go") {
    if (["build", "test", "run", "get", "mod"].includes(sub)) {
      return `${exe} ${sub}`;
    }
    return exe;
  }

  // Containers & Infrastructure
  if (exe === "docker" || exe === "docker-compose") {
    if (["run", "build", "ps", "exec", "up", "down"].includes(sub)) {
      return `${exe} ${sub}`;
    }
    return exe;
  }
  if (exe === "kubectl") {
    if (["get", "describe", "apply", "logs"].includes(sub)) {
      return `${exe} ${sub}`;
    }
    return exe;
  }
  if (exe === "terraform") {
    if (["plan", "apply", "destroy", "init"].includes(sub)) {
      return `${exe} ${sub}`;
    }
    return exe;
  }

  return null;
}
