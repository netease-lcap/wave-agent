/**
 * 一条命令的非零退出该读成「失败」还是「它自己的答案」——对齐 CC 的
 * `returnCodeInterpretation`。
 *
 * CC 把这件事放在 shell 工具里，不在 `$` 里：`0766-6267394B-AL.js` 的
 * `v5i`（POSIX）与 `rYi` / `sYi`（PowerShell）是两张家族表，家族内的 exit 1 不算
 * 失败、只给一句解释（`isError: n >= 2` + `message`），其余非零照常失败；命令含
 * `&&` 时整体不豁免（`_zi`），因为那时退出码是链上最后一环的，不代表那个家族。
 *
 * 这里是那张表的唯一落点：工具用它决定 `success` 与 `data.returnCodeInterpretation`，
 * `$` 直接读工具的结论，不再自己解析命令。
 */

export interface ShellExitVerdict {
  /** 这个非零退出是否算失败。 */
  failed: boolean;
  /** 家族内 exit 1 的语义解释（CC 的 `returnCodeInterpretation`）。 */
  interpretation?: string;
}

/**
 * POSIX shell 里 exit 1 是答案的命令，值照 CC 的 `message`。
 *
 * 一张表只覆盖「1 = 无匹配 / 有差异 / 条件为假」这一格：家族外的 1 与家族内的
 * 其它非零码仍然是失败。
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
  if (exitCode < 0 || exitCode >= 8) return { failed: true };
  if (exitCode === 0) {
    return {
      failed: false,
      interpretation: "No files copied (already in sync)",
    };
  }
  return {
    failed: false,
    interpretation:
      exitCode & 1
        ? "Files copied successfully"
        : "Robocopy completed (no errors)",
  };
}

/**
 * 命令含 `&&` 链时家族豁免整体失效——CC 的 `_zi`：顶层是 `list` 且前一个孩子是
 * `&&` 就不看家族表。此时退出码属于链上最后一环，不能拿它的名字当答案。
 */
function hasAndChain(command: string): boolean {
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "&" && command[index + 1] === "&") return true;
  }
  return false;
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

function exitOneInterpretation(
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
  if (exitCode === 0) return { failed: false };
  if (exitCode !== 1 || hasAndChain(command)) return { failed: true };
  const interpretation = exitOneInterpretation(
    command,
    POSIX_EXIT_ONE_IS_AN_ANSWER,
    POSIX_GIT_SUBCOMMANDS,
  );
  return interpretation === undefined
    ? { failed: true }
    : { failed: false, interpretation };
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
  if (exitCode === 0) return { failed: false };
  if (exitCode !== 1 || hasAndChain(command)) return { failed: true };
  const interpretation = exitOneInterpretation(
    command,
    POWERSHELL_EXIT_ONE_IS_AN_ANSWER,
  );
  return interpretation === undefined
    ? { failed: true }
    : { failed: false, interpretation };
}
