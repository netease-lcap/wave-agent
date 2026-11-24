/**
 * 一条命令的非零退出该怎么读——对齐 CC 的 `returnCodeInterpretation`。
 *
 * CC 把这件事放在 shell 工具里，不在 `$` 里：`0766-6267394B-AL.js` 的
 * `v5i`（POSIX）与 `rYi` / `sYi`（PowerShell）是两张家族表，家族判定是
 * `fU = (e) => (n) => ({ isError: n >= 2, message: n === 1 ? e : void 0 })`——
 * **只有 exit 1 给解释句**，家族内 2 起 `isError` 为真且不带 `message`；非家族走兜底
 * `q3o` / `a5o`（解释是 `Command failed with exit code ${n}`、`isError` 为真）；
 * `robocopy` 另有 0–7 档。
 *
 * 命令含 `&&` 时**不豁免**：工具正文那条链直接调 `$Kt`（`$Kt = R5i(cmd)(code)`），
 * 家族只看最后一个命令词。带豁免的 `z3o`（`_zi`）挂在别处——`X5i = { bash: z3o,
 * powershell: f5o }` 只被 `kEe`（后台任务状态）用，与正文无关，我方没有那一层。
 *
 * **`isError` 不等于「这次调用失败」**：它只决定正文要不要补一行 `Exit code <n>`
 * （见 `resultData/bash.ts`）。命令跑起来了，退出码是它的答案，不是工具没执行成——
 * `success` 只留给「命令根本没跑起来」。
 *
 * 这里是那张表的唯一落点：工具用它产出 `data.returnCodeInterpretation`，`$` 直接
 * 读工具的结论，不再自己解析命令。
 */

export interface ShellExitVerdict {
  /**
   * 退出码的读法：家族内 exit 1 / `robocopy` 0–7 的读法，或非家族的兜底句
   * {@link fallbackInterpretation}（CC 的 `q3o`）。家族内 2 起与退出码 0 都缺省。
   */
  interpretation?: string;
  /**
   * 正文末尾要不要补一行 `Exit code <n>`（CC 的 `isError`）：家族内 2 起与非家族的
   * 任何非零码；家族内 1 与 `robocopy` 0–7 不补。
   */
  noteExitCode: boolean;
}

/**
 * 兜底解释，照 CC 的 `q3o` / `a5o`：`Command failed with exit code ${n}`（我们多一
 * 个冒号，与既有文案一致）。
 */
export function fallbackInterpretation(exitCode: number): string {
  return `Command failed with exit code: ${exitCode}`;
}

/**
 * POSIX shell 里 exit 1 是答案的命令，值照 CC 的 `message`。
 *
 * 表里给的是「1 这个退出码怎么读」：家族内的 1 用它，家族内的其它非零码没有读法
 * （照 CC 的 `fU`，`message` 缺省），家族外的一律走兜底句。
 */
const POSIX_EXIT_ONE_IS_AN_ANSWER = new Map<string, string>([
  ["grep", "No matches found"],
  ["egrep", "No matches found"],
  ["fgrep", "No matches found"],
  ["rg", "No matches found"],
  ["find", "Some directories were inaccessible"],
  ["diff", "Files differ"],
  ["test", "Condition is false"],
  ["[", "Condition is false"],
]);

/** `git <sub>` 里同样以 exit 1 作答的两个子命令。 */
const POSIX_GIT_SUBCOMMANDS = new Map<string, string>([
  ["diff", "Files differ"],
  ["grep", "No matches found"],
]);

/** PowerShell 的表：同样的口径，命令名按 Windows 那一侧（CC 的 `rYi` / `sYi`）。 */
const POWERSHELL_EXIT_ONE_IS_AN_ANSWER = new Map<string, string>([
  ["grep", "No matches found"],
  ["egrep", "No matches found"],
  ["fgrep", "No matches found"],
  ["rg", "No matches found"],
  ["findstr", "No matches found"],
  ["where", "No matching files found"],
  ["fc", "Files differ"],
  ["diff", "Files differ"],
]);

/**
 * `robocopy` 的退出码不是「非零即错」：0–7 都是某种程度的成功，8 起才是失败
 * （照 CC 的 `e < 0 || e >= 8`）。
 */
function robocopyVerdict(exitCode: number): ShellExitVerdict {
  if (exitCode < 0 || exitCode >= 8) {
    return {
      interpretation: fallbackInterpretation(exitCode),
      noteExitCode: true,
    };
  }
  if (exitCode === 0) {
    return {
      noteExitCode: false,
      interpretation: "No files copied (already in sync)",
    };
  }
  return {
    noteExitCode: false,
    interpretation:
      exitCode & 1
        ? "Files copied successfully"
        : "Robocopy completed (no errors)",
  };
}

/**
 * 命令按 shell 自己的运算符切成段，每段是一串词。
 *
 * 引号里的内容算数据（`rg "a|b" src` 是一条命令），前缀 `NAME=value` 的赋值不算
 * 命令名。
 */
function commandSegments(command: string): string[][] {
  const segments: string[][] = [];
  let words: string[] = [];
  let word = "";
  let quote: '"' | "'" | undefined;
  const endWord = () => {
    if (word !== "") {
      words.push(word);
      word = "";
    }
  };
  const endSegment = () => {
    endWord();
    if (words.length > 0) segments.push(words);
    words = [];
  };
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      else word += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "\\" && index + 1 < command.length) {
      index += 1;
      word += command[index];
      continue;
    }
    if (char === " " || char === "\t") {
      endWord();
      continue;
    }
    if (char === "\n" || char === ";" || char === "&" || char === "|") {
      endSegment();
      // `&&` 与 `||` 是一个运算符，跳过第二个字符。
      if (index + 1 < command.length && command[index + 1] === char) index += 1;
      continue;
    }
    word += char;
  }
  endSegment();
  return segments;
}

/**
 * 命令行的最后一个命令词，以及它后面那个词。
 *
 * 「最后一个」才是这里要的：`rg foo` 无匹配时退 1，但 `rg foo | head` 退的是
 * `head` 的状态。路径（`/usr/bin/grep`）按 basename 读。
 */
function lastCommandWord(
  command: string,
): { word: string; next?: string } | undefined {
  const segments = commandSegments(command);
  for (let index = segments.length - 1; index >= 0; index--) {
    const words = segments[index].slice();
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
      words.shift();
    }
    if (words.length === 0) continue;
    const word = words[0].split("/").pop() ?? words[0];
    return words.length > 1 ? { word, next: words[1] } : { word };
  }
  return undefined;
}

/**
 * 这个命令行落在哪张家族表里（CC 的 `R5i`），返回它的读法——**与退出码无关**。
 *
 * 只有 `exit 1` 才用得上这份读法（CC 的 `fU` 只在 `n === 1` 时给 `message`），但
 * 「是不是家族命令」这件事必须能单独问出来：家族内 2 起既不带解释、又要补
 * `Exit code <n>`。
 */
function familyReading(
  command: string,
  table: Map<string, string>,
  gitSubcommands?: Map<string, string>,
): string | undefined {
  const found = lastCommandWord(command);
  if (!found) return undefined;
  if (gitSubcommands && found.word === "git" && found.next !== undefined) {
    return gitSubcommands.get(found.next);
  }
  return table.get(found.word);
}

/**
 * `Bash` 的判定：家族表照 CC 的 POSIX 一档（`v5i` + `git diff` / `git grep`）。
 */
export function interpretBashExit(
  command: string,
  exitCode: number,
): ShellExitVerdict {
  if (exitCode === 0) return { noteExitCode: false };
  const reading = familyReading(
    command,
    POSIX_EXIT_ONE_IS_AN_ANSWER,
    POSIX_GIT_SUBCOMMANDS,
  );
  if (reading === undefined) {
    return {
      noteExitCode: true,
      interpretation: fallbackInterpretation(exitCode),
    };
  }
  // 家族内：1 是命令自己的答案；2 起照 CC 的 `fU` 仍算错，且**不给**解释句。
  return exitCode === 1
    ? { noteExitCode: false, interpretation: reading }
    : { noteExitCode: true };
}

/**
 * `PowerShell` 的判定：同一个口径，命令名换成 Windows 那一侧的表，外加
 * `robocopy` 的 0–7 档。
 */
export function interpretPowerShellExit(
  command: string,
  exitCode: number,
): ShellExitVerdict {
  // `robocopy` is asked first: its 0 is a reading of its own ("no files copied,
  // already in sync"), not the silent 0 every other command gets.
  if (lastCommandWord(command)?.word === "robocopy")
    return robocopyVerdict(exitCode);
  if (exitCode === 0) return { noteExitCode: false };
  const reading = familyReading(command, POWERSHELL_EXIT_ONE_IS_AN_ANSWER);
  if (reading === undefined) {
    return {
      noteExitCode: true,
      interpretation: fallbackInterpretation(exitCode),
    };
  }
  // 与 `Bash` 同一条 CC 口径（`fU`）：家族内 1 作答，2 起补退出码、不给解释。
  return exitCode === 1
    ? { noteExitCode: false, interpretation: reading }
    : { noteExitCode: true };
}
