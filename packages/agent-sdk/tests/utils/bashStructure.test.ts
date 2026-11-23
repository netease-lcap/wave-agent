/**
 * Table-driven unit tests for the structure-aware bash parser
 * (packages/agent-sdk/src/utils/bashStructure).
 *
 * The parser expands shell compound commands (for/while/until/if/case/select/
 * functions) and command substitutions ($( ) / backticks) into a flat list of
 * "leaf" simple commands that the permission layer classifies independently.
 *
 * Two tables:
 *   1. The 12 acceptance scenarios of the spec story "复合命令与命令替换的
 *      结构感知判定" (docs/specs/core/tool-permission-system.md) — each
 *      command is classified allow/ask with a small oracle that mirrors
 *      PermissionManager.isAutoAllowedPart against the expanded leaves
 *      (read-only sets, Safe Zone path checks, allow rules). P1 deliberately
 *      keeps the oracle in-test: the real permission wiring lands in P2.
 *   2. A regression corpus of 41 real Bash commands extracted from
 *      session transcripts across worktrees (the first 31 from
 *      strong-loud-storm spec-crawl sessions, the last 10 mined from other
 *      wave-agent sessions: claude-ai front-end archaeology, desktopHost /
 *      CI / node_modules greps, HTTP health probes). Only parse stability is
 *      asserted: every command must parse to the exact expected leaf
 *      signature (command name sequence + unsafe flag) so structural
 *      regressions (ghost leaves, dropped redirects, lexer failures) surface.
 *      The last three entries are fail-closed samples (process substitution,
 *      arithmetic expansion, function definition) whose "unsupported" status
 *      must be preserved.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_COMMAND_LENGTH,
  parseBashStructure,
  parseBashStructureDetailed,
} from "../../src/utils/bashStructure/index.js";
import {
  hasCommandSubstitution,
  hasProcessSubstitution,
  hasSedInPlace,
  hasWriteRedirections,
  isDangerousFind,
  extractPathArgs,
  PATH_COMMANDS,
  READ_ONLY_COMMANDS,
} from "../../src/utils/bashParser.js";
import { isPathInside } from "../../src/utils/pathSafety.js";
import { SAFE_SHELL_BUILTINS } from "../../src/utils/bashStructure/types.js";

// CWD assumed by the spec scenarios.
const WORKDIR = "/home/user/project";

/** Resolve an argument against the Safe Zone (workdir + additional dirs). */
function insideSafeZone(
  arg: string,
  workdir: string,
  extra: string[] = [],
): boolean {
  const absolute = path.isAbsolute(arg) ? arg : path.resolve(workdir, arg);
  return [workdir, ...extra].some((r) => isPathInside(absolute, r));
}

/** Strip one layer of outer quotes for rule-text reconstruction. */
function unquoteArg(arg: string): string {
  if (
    arg.length >= 2 &&
    ((arg[0] === '"' && arg[arg.length - 1] === '"') ||
      (arg[0] === "'" && arg[arg.length - 1] === "'"))
  ) {
    return arg.slice(1, -1);
  }
  return arg;
}

/** Mirror matchesRule for Bash(<pattern>) allow rules. */
function bashRuleMatches(rule: string, text: string): boolean {
  const m = rule.match(/^Bash\((.*)\)$/);
  if (!m) return false;
  const regexPattern = m[1]
    .replace(/[.+^${}()|[\]\\?]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${regexPattern}$`, "s").test(text);
}

/**
 * Mirror PermissionManager.isAutoAllowedPart + explicit allow rules against a
 * single expanded leaf. Returns false whenever the leaf must be confirmed.
 */
function leafAutoAllowed(
  leaf: { command: string; argv: string[]; text: string; unsafe: boolean },
  workdir: string,
  rules: string[],
  extraDirs: string[] = [],
): boolean {
  if (leaf.unsafe) return false;
  // Write / substitution / in-place-edit variants disqualify (FR-019.4-6)
  if (hasWriteRedirections(leaf.text)) return false;
  if (hasCommandSubstitution(leaf.text)) return false;
  if (hasProcessSubstitution(leaf.text)) return false;
  if (hasSedInPlace(leaf.text)) return false;

  const command = leaf.command;
  const args = leaf.argv.slice(1).join(" ");

  // cd is not read-only but is safe when all paths stay inside the Safe Zone
  if (command === "cd") {
    const pathArgs = (args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [])
      .filter((a) => !a.startsWith("-"))
      .map(unquoteArg);
    if (pathArgs.length === 0) return true;
    return pathArgs.every((p) => insideSafeZone(p, workdir, extraDirs));
  }

  if (READ_ONLY_COMMANDS.includes(command)) {
    if (command === "find" && isDangerousFind(leaf.text)) return false;
    if (PATH_COMMANDS.includes(command)) {
      const pathArgs = extractPathArgs(args);
      if (pathArgs.length > 0) {
        if (!workdir) return false;
        if (!pathArgs.every((p) => insideSafeZone(p, workdir, extraDirs))) {
          return false;
        }
      }
    }
    return true;
  }

  // Shell builtins that only read stdin into variables / print (read, echo).
  if (SAFE_SHELL_BUILTINS.has(command)) return true;

  // Non-read-only commands: allow only via an explicit rule. Rule matching
  // targets the expanded leaf with outer quotes removed (spec scenario 11:
  // `node "scripts/$f" --dry-run` must match Bash(node scripts*)).
  const ruleText = [command, ...leaf.argv.slice(1).map(unquoteArg)].join(" ");
  return rules.some((r) => bashRuleMatches(r, ruleText));
}

/** Whole-command verdict: allow only when every expanded leaf auto-allows. */
function classify(
  command: string,
  opts: { workdir?: string; rules?: string[]; extraDirs?: string[] } = {},
): "allow" | "ask" {
  const result = parseBashStructure(command);
  if (result.status === "unsupported") return "ask"; // fail-closed
  const workdir = opts.workdir ?? WORKDIR;
  const rules = opts.rules ?? [];
  const extraDirs = opts.extraDirs ?? [];
  return result.leaves.every((l) =>
    leafAutoAllowed(l, workdir, rules, extraDirs),
  )
    ? "allow"
    : "ask";
}

// ── Spec acceptance scenarios ───────────────────────────────────────────
interface Scenario {
  n: number;
  command: string;
  expect: "allow" | "ask";
  rules?: string[];
  extraDirs?: string[];
}

const SPEC_SCENARIOS: Scenario[] = [
  // 1. loop body is only `head`, read-only inside the Safe Zone
  {
    n: 1,
    command: `for f in a.txt b.txt; do head -5 "$f"; done`,
    expect: "allow",
  },
  // 2. while / if / case control keywords never participate in judgement
  {
    n: 2,
    command: `for f in "$@"; do sed -n '1,10p' "$f"; done`,
    expect: "allow",
  },
  {
    n: 2,
    command: `while read -r line; do echo "$line"; done < input.txt`,
    expect: "allow",
  },
  { n: 2, command: `case "$x" in foo) grep foo docs/;; esac`, expect: "allow" },
  {
    n: 2,
    command: `if grep -q pattern docs/specs/; then echo found; fi`,
    expect: "allow",
  },
  // 3. nested $(ls docs/) is read-only; echo/head read-only
  {
    n: 3,
    command: `for f in $(ls docs/); do echo "== $f =="; head -3 "docs/$f"; done`,
    expect: "allow",
  },
  // 4. assignment statement records var source; grep/tr/echo read-only
  {
    n: 4,
    command: `count=$(grep -c error log.txt | tr -d ' '); echo "count=$count"`,
    expect: "allow",
  },
  // 5. rm / git push inside loops and branches still ask
  { n: 5, command: `for f in a.txt b.txt; do rm "$f"; done`, expect: "ask" },
  { n: 5, command: `if true; then git push; fi`, expect: "ask" },
  // 6. destructive command substitutions still ask
  { n: 6, command: `head -5 $(rm -f a.txt)`, expect: "ask" },
  { n: 6, command: `echo $(git commit -m x)`, expect: "ask" },
  // 7. process substitution is not statically reducible → always ask
  { n: 7, command: `cat <(echo hi)`, expect: "ask" },
  { n: 7, command: `diff <(sort a) <(sort b)`, expect: "ask" },
  {
    n: 7,
    command: `while read x; do echo "$x"; done >(tee out)`,
    expect: "ask",
  },
  // 8. path-zone rule applies per expanded command, inside $( ) too
  {
    n: 8,
    command: `for f in $(cat /etc/passwd); do echo "$f"; done`,
    expect: "ask",
  },
  // 9. fail-closed constructs
  { n: 9, command: `echo $((1+2))`, expect: "ask" },
  { n: 9, command: `echo {a,b}`, expect: "ask" },
  { n: 9, command: `eval "ls"`, expect: "ask" },
  { n: 9, command: `trap 'echo hi' EXIT`, expect: "ask" },
  // 10. bare (unquoted) loop-variable references are not auto-allowed
  { n: 10, command: `for i in -rf /; do rm $i; done`, expect: "ask" },
  {
    n: 10,
    command: `for f in a.txt b.txt; do head -5 $f; done`,
    expect: "ask",
  },
  // 11. allow rules match each expanded leaf (node "scripts/$f" --dry-run)
  {
    n: 11,
    command: `for f in $(ls scripts); do node "scripts/$f" --dry-run; done`,
    expect: "allow",
    rules: ["Bash(node scripts*)"],
  },
  // 12. cd outside the Safe Zone is unaffected by the loop wrapper
  {
    n: 12,
    command: `cd /etc && for f in $(ls); do echo "$f"; done`,
    expect: "ask",
  },
];

describe("bashStructure spec scenarios", () => {
  it.each(
    SPEC_SCENARIOS.map(
      (s) => [s.n, s.command, s.expect, s.rules, s.extraDirs] as const,
    ),
  )("spec scenario %i → %s", (n, command, expected, rules, extraDirs) => {
    const verdict = classify(command, { rules, extraDirs });
    expect(verdict, `spec scenario ${n}: ${command}`).toBe(expected);
  });
});

// ── Real-command regression corpus ──────────────────────────────────────
// Commands captured verbatim from strong-loud-storm session transcripts.
const CORPUS: string[] = [
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm && for f in $(ls docs/specs/ui/*.md); do h=$(grep -m1 "^name:" "$f" | sed \'s/name: *"//;s/"$//\'); echo "$(basename $f) :: $h"; done',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm && for n in confirm-ui stdio-transport ide-plugin; do echo "==== $n ===="; grep -rn --include="*.md" -wE "(${n}|${n}\\\\.md)" docs/ | grep -v "docs/specs/ui/" | head; done 2>/dev/null | head -80',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm/docs/specs/ui && for f in *.md; do line=$(grep -m1 -E "^> 本规格覆盖|^> \\\\*\\\\*覆盖|^> 覆盖|^> 本规格|^> 同时|^> 适用" "$f"); if [ -n "$line" ]; then echo "### $f"; echo "$line"; fi; done',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm/packages && for f in $(grep -rl "desktop-app\\\\.md" --include="*.ts" --include="*.tsx" . | sort); do echo "########## $f"; grep -n -B1 -A1 "desktop-app\\\\.md" "$f" | head -30; done',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm/docs/specs && for f in $(grep -rl "桌面" --include="*.md" . | sort); do c=$(grep -c "桌面" "$f"); us=$(grep -c "^### 用户故事" "$f"); echo "$c 桌面/$us 故事  $f"; done',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm/docs/specs/ui && for f in *.md; do code=$(grep -o "packages/code\\\\|CLI（\\\\|CLI (\\\\|CLI 宿\\\\|Ink\\\\|终端\\\\|stdin" "$f" | wc -l); wv=$(grep -o "packages/webview\\\\|Webview 三端\\\\|共享 webview\\\\|shared webview" "$f" | wc -l); echo "$f code=$code webview=$wv"; done',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm/docs/specs && grep -rln "桌面端" --include="*.md" . -l | while read f; do us=$(grep -c "^### 用户故事" "$f"); printf "%-55s stories=%s\\\\n" "$f" "$us"; done | sort',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm/docs/specs/desktop && for f in *.md; do echo "== $f"; grep -c "^### 用户故事" "$f" | sed \'s/^/stories: /\'; grep -c "^- \\\\*\\\\*" "$f" | sed \'s/^/bullets: /\'; done',
  'cd /home/liuyiqi/github/wave-agent && git show HEAD:docs/specs/ui/desktop-app.md > /tmp/desktop-app-orig.md 2>/dev/null && grep -c "" /tmp/desktop-app-orig.md && grep -n "^### 用户故事：" /tmp/desktop-app-orig.md',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm && git status --short; echo "=== log ==="; git log --oneline -3; echo "=== 残留引用 ==="; grep -rn "desktop-app\\\\.md" packages/ --include="*.ts" --include="*.tsx" --include="*.css" 2>/dev/null | grep -v node_modules | wc -l',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm && echo "=== root package.json docs scripts ==="; grep -n \'"docs\' package.json; echo "=== docs build in CI ==="; ls .github/workflows/ 2>/dev/null; grep -rln "docs:build\\\\|vitepress\\\\|spec-stats\\\\|check-docs-links\\\\|check-sidebar" .github/ 2>/dev/null',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm && echo "=== spec-count references across repo ==="; grep -rn "spec.count\\\\|规格文件.*值\\\\|totals\\\\.specs\\\\|specs.length\\\\|spec-count\\\\|规格文件:" . 2>/dev/null | grep -v node_modules | grep -iv "docs/specs\\\\|spec-count 到\\\\|：79/4" | grep -n "spec\\\\|规格" | grep -iv "功能规格说明\\\\|## \\\\|# " | head -20',
  "cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm/docs/specs/ui && for f in *.md; do o=$(grep -m1 '^order:' \"$f\" | awk '{print $2}'); echo \"$o  $(basename $f)\"; done | sort -n",
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm/docs/specs/ui && for f in *.md; do echo "########## $f"; awk \'NR>1 && /^### 用户故事/{exit} /^# /||/^> /||/^\\\\*\\\\*[^:：]*\\\\*\\\\*：|^背景|^## /{print}\' "$f" | head -6; done 2>/dev/null | head -260',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm && echo "=== search for hardcoded spec totals in code/tests ==="; grep -rn "规格: 79\\\\|, 196\\\\|1968\\\\|2049\\\\|specs: 79\\\\|79 个\\\\|total specs\\\\|规格文件" docs packages scripts .github 2>/dev/null | grep -v "spec-count\\\\|spec-stats\\\\|specs.data\\\\|index.md:" | head',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm && grep -rnE "specs/ui|specs/u/|ui/.*(\\\\.md|spec)" packages/ --include="*.ts" --include="*.tsx" --include="*.kt" --include="*.js" --include="*.css" 2>/dev/null | grep -viE "node_modules|packages/vscode/webview|/dist/|/build/"; echo "=== code charts done ==="',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm/docs/specs && grep -rln "桌面端" --include="*.md" . -l | while read f; do us=$(grep -c "^### 用户故事" "$f"); printf "%-55s stories=%s\\\\n" "$f" "$us"; done | sort | tail -5',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm/docs/specs/desktop && for f in *.md; do echo "########## $f"; grep -n "^### 用户故事：\\\\|^\\\\*\\\\*[0-9]*\\\\. \\\\*\\\\*假设\\\\|^[0-9]*\\\\. \\\\*\\\\*假设\\\\|^### \\\\|^## " "$f" | grep -c "^.*假设" ; done',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm && cat docs/.vitepress/theme/index.js | head -40; echo "=== order histogram ==="; grep -rh "^order:" docs/specs/ui/ | sort -t: -k2 -n | uniq -c',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm && echo "=== absolute /specs/ links anywhere in docs md ==="; grep -rn "/specs/ui/\\\\|/specs/" docs --include="*.md" | grep "desktop\\\\|](=/specs/ui/" | head; echo "=== done ==="',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm && echo "=== files with frontmatter order ===" && grep -rl "^order:" docs/specs/ | sort && echo "=== count files total ===" && ls docs/specs/*/ | grep -c "\\\\.md$"',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm && echo "=== grep desktop-app across whole repo ==="; grep -rn "desktop-app\\\\.md\\\\|desktop-account-card-and-panel-tabs" . --include="*.ts" --include="*.mjs" --include="*.js" 2>/dev/null | grep -v node_modules | grep -v "/dist/" | head',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm/docs/specs && grep -n "^#" ui/desktop-app.md | tail -20; echo "=== account-card tail ==="; grep -n "^#" ui/desktop-account-card-and-panel-tabs.md',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm/docs/specs && wc -l ui/desktop-app.md ui/desktop-account-card-and-panel-tabs.md 2>/dev/null && echo --- && grep -c "桌面\\\\|desktop" ui/desktop-app.md ui/desktop-account-card-and-panel-tabs.md',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm/docs/specs/ui && for f in *.md; do echo "### $f"; awk \'/^(name|description):/{gsub(/^[a-z]+: */,""); print; if(++n>=2) exit}\' "$f"; done',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm && node "/tmp/wave-builtin/24cf61ad0c2b3146/plugins/sdd/scripts/spec-count.js" 2>&1 | grep -E "desktop|警告|warning|WARN|缺" ; echo "exit=$?"',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm && node scripts/check-docs-links.mjs 2>&1 | tail -15; echo "---anchors---"; node scripts/check-sidebar-anchors.mjs 2>&1 | tail -10',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm && pnpm -F wave-webview-fixtures build 2>&1 | tail -3 && grep -rn "desktop-app\\\\.md" packages/webview-fixtures/dist/ | head',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm/docs/specs/desktop && sed -n \'255,275p\' desktop-sessions.md && echo "=== account-card spec 落点 ===" && grep -n "更新按钮\\\\|S0" desktop-settings.md | head -5',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm && for f in docs/specs/ui/*.md; do echo "=== $f ==="; head -8 "$f" | grep -E \'order:|path:|^---\'; done',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/strong-loud-storm/docs/specs && grep -rln "Plan 面板\\\\|计划面板" --include="*.md" . | head; echo "=== done ==="',
  "cd ~/github/claude-ai && awk '/Resize file tree/{for(i=NR-15;i<=NR+5;i++) print i\": \"a[i]} {a[NR]=$0}' shared-14-Bu7AnnJ1.js | cut -c1-200",
  "cd /home/liuyiqi/github/wave-agent && grep -rn 'getMcpConfigPaths\\|getMcpServers\\|workingDirectory' packages/desktop/src/stdio/*.ts | head -20",
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/long-kind-glacier && git log --all --oneline --grep="全屏" | head -10; git log --all --oneline --grep="fullscreen" -i | head -10',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/fix-pr-2063-ci && ls .github/workflows/ 2>/dev/null && grep -rn "shard" .github/workflows/*.yml 2>/dev/null | head',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/tame-narrow-cloud/packages/webview && grep -n "_willUpdate" node_modules/@tanstack/virtual-core/dist/esm/index.js | head -5',
  'grep -rln "watch-merge-mr\\|commit-push-mr" /home/liuyiqi/gitlab/codechat/.wave 2>/dev/null | grep -v node_modules | head; echo "---plugin cache---"; find /home/liuyiqi/.wave/plugins/cache -maxdepth 3 -type d 2>/dev/null | head -30',
  'for u in "https://neteasecc.codewave-test.163yun.com/api/health" "https://codechat.codewave-test.163yun.com/api/health"; do echo -n "$u → "; curl -s -o /dev/null -w \'%{http_code}\\n\' --max-time 10 "$u"; done; echo "---unauth API 401 check---"; for u in "https://neteasecc.codewave-test.163yun.com/api/ops/enterprises" "https://codechat.codewave-test.163yun.com/api/enterprise/usage/overview"; do echo -n "$u → "; curl -s -o /dev/null -w \'%{http_code}\\n\' --max-time 10 "$u"; done',
  'cd ~/github/claude-ai && ls *.js | wc -l; comm -23 <(grep -o \'import("./[^"]*\\.js")\' index-CBKtDRUS.js | sort -u | sed \'s/import(".\\///;s/")//\') <(ls *.js | sort) ',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/low-bold-tiger/packages/agent-sdk && for l in 1005 1041 1215; do sed -n "$((l-8)),$((l-1))p" src/managers/aiManager.ts | grep -E "private |public |async " ; echo "--- $l"; done',
  'cd /home/liuyiqi/github/wave-agent/.wave/worktrees/slow-shallow-peak && Grep() { :; }; grep -n "ExitPlanMode\\|退出计划\\|计划面板\\|plan 面板\\|planContent" docs/specs/ui/desktop-app.md | head -40',
];

// Expected leaf signatures, recorded when the corpus was curated: per entry
// either [status:"ok", [command, unsafe][]], or ["unsupported", reason].
// A parser change that alters leaf structure or status must be reviewed here.
const CORPUS_SIGS: (["ok", [string, boolean][]] | ["unsupported", string])[] = [
  [
    "ok",
    [
      ["cd", false],
      ["ls", false],
      ["grep", false],
      ["sed", false],
      ["basename", true],
      ["echo", true],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["echo", false],
      ["grep", false],
      ["grep", false],
      ["head", false],
      ["head", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["grep", false],
      ["[", false],
      ["echo", false],
      ["echo", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["grep", false],
      ["sort", false],
      ["echo", false],
      ["grep", false],
      ["head", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["grep", false],
      ["sort", false],
      ["grep", false],
      ["grep", false],
      ["echo", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["grep", false],
      ["wc", false],
      ["grep", false],
      ["wc", false],
      ["echo", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["grep", false],
      ["read", false],
      ["grep", false],
      ["printf", false],
      ["sort", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["echo", false],
      ["grep", false],
      ["sed", false],
      ["grep", false],
      ["sed", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["git", false],
      ["grep", false],
      ["grep", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["git", false],
      ["echo", false],
      ["git", false],
      ["echo", false],
      ["grep", false],
      ["grep", false],
      ["wc", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["echo", false],
      ["grep", false],
      ["echo", false],
      ["ls", false],
      ["grep", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["echo", false],
      ["grep", false],
      ["grep", false],
      ["grep", false],
      ["grep", false],
      ["grep", false],
      ["head", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["grep", false],
      ["awk", false],
      ["basename", true],
      ["echo", true],
      ["sort", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["echo", false],
      ["awk", false],
      ["head", false],
      ["head", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["echo", false],
      ["grep", false],
      ["grep", false],
      ["head", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["grep", false],
      ["grep", false],
      ["echo", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["grep", false],
      ["read", false],
      ["grep", false],
      ["printf", false],
      ["sort", false],
      ["tail", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["echo", false],
      ["grep", false],
      ["grep", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["cat", false],
      ["head", false],
      ["echo", false],
      ["grep", false],
      ["sort", false],
      ["uniq", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["echo", false],
      ["grep", false],
      ["grep", false],
      ["head", false],
      ["echo", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["echo", false],
      ["grep", false],
      ["sort", false],
      ["echo", false],
      ["ls", false],
      ["grep", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["echo", false],
      ["grep", false],
      ["grep", false],
      ["grep", false],
      ["head", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["grep", false],
      ["tail", false],
      ["echo", false],
      ["grep", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["wc", false],
      ["echo", false],
      ["grep", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["echo", false],
      ["awk", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["node", false],
      ["grep", false],
      ["echo", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["node", false],
      ["tail", false],
      ["echo", false],
      ["node", false],
      ["tail", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["pnpm", false],
      ["tail", false],
      ["grep", false],
      ["head", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["sed", false],
      ["echo", false],
      ["grep", false],
      ["head", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["echo", false],
      ["head", false],
      ["grep", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["grep", false],
      ["head", false],
      ["echo", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["awk", false],
      ["cut", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["grep", false],
      ["head", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["git", false],
      ["head", false],
      ["git", false],
      ["head", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["ls", false],
      ["grep", false],
      ["head", false],
    ],
  ],
  [
    "ok",
    [
      ["cd", false],
      ["grep", false],
      ["head", false],
    ],
  ],
  [
    "ok",
    [
      ["grep", false],
      ["grep", false],
      ["head", false],
      ["echo", false],
      ["find", false],
      ["head", false],
    ],
  ],
  [
    "ok",
    [
      ["echo", false],
      ["curl", false],
      ["echo", false],
      ["echo", false],
      ["curl", false],
    ],
  ],
  ["unsupported", "process-substitution"],
  ["unsupported", "arithmetic-expansion"],
  // `Grep() { :; }; grep …`: a function definition expands to its body now, so
  // the `:` it defines is a leaf like any other and the call site is ordinary.
  [
    "ok",
    [
      ["cd", false],
      [":", false],
      ["grep", false],
      ["head", false],
    ],
  ],
];

describe("bashStructure real-command corpus", () => {
  it("every corpus command matches its recorded leaf signature", () => {
    expect(CORPUS.length).toBe(41);
    expect(CORPUS_SIGS.length).toBe(CORPUS.length);
    CORPUS.forEach((command, i) => {
      const result = parseBashStructure(command);
      const sig = CORPUS_SIGS[i];
      if (sig[0] === "unsupported") {
        expect(result, `corpus[${i}] should fail closed`).toMatchObject({
          status: "unsupported",
          reason: sig[1],
        });
        return;
      }
      expect(result, `corpus[${i}] should parse`).toMatchObject({
        status: "ok",
      });
      const leaves = result.status === "ok" ? result.leaves : [];
      const got = leaves.map((l) => [l.command, l.unsafe]);
      expect(got, `corpus[${i}] leaf signature`).toEqual(sig[1]);
      // structural invariants: leaves carry a command word + text
      for (const leaf of leaves) {
        expect(leaf.argv.length).toBeGreaterThan(0);
        expect(leaf.text.length).toBeGreaterThan(0);
      }
    });
  });
});

describe("parseBashStructureDetailed — data versus commands", () => {
  it("drops a heredoc body, keeping the command it belongs to", () => {
    const detail = parseBashStructureDetailed(
      "git add -A && git commit -F - <<'MSG'\n\nfix PowerShell quoting\nrm -rf ../..\n\nMSG",
    );
    expect(detail.errors).toEqual([]);
    expect(detail.aborted).toBe(false);
    expect(detail.heredocRegions).toBe(1);
    expect(detail.dataRegions).toBeGreaterThan(0);
    expect(detail.commandText).not.toContain("PowerShell");
    expect(detail.leaves.map((leaf) => leaf.argv)).toEqual([
      ["git", "add", "-A"],
      ["git", "commit", "-F", "-"],
    ]);
  });

  it("drops a comment", () => {
    const detail = parseBashStructureDetailed("ls -la   # rm -rf /");
    expect(detail.dataRegions).toBe(1);
    expect(detail.heredocRegions).toBe(0);
    expect(detail.commandText).not.toContain("rm -rf");
    expect(detail.leaves.map((leaf) => leaf.argv)).toEqual([["ls", "-la"]]);
  });

  it("drops a quoted here-string", () => {
    const detail = parseBashStructureDetailed("grep x <<< 'rm -rf /'");
    expect(detail.errors).toEqual([]);
    expect(detail.dataRegions).toBe(1);
    // The operator goes with its operand: `grep x` is what is left to parse.
    expect(detail.commandText).toBe("grep x ");
  });

  it("reports a heredoc it cannot establish as data", () => {
    // Unclosed, and unquoted with an expansion that would really run: neither
    // body can be cut, so both stay in the text the caller judges.
    for (const command of [
      "cat <<EOF\nnever closed\n",
      "cat <<EOF\n$(rm -rf ../..)\nEOF",
    ]) {
      const detail = parseBashStructureDetailed(command);
      expect(detail.errors).toContain("heredoc");
      expect(detail.heredocRegions).toBe(0);
      expect(detail.commandText).toBe(command);
      expect(detail.leaves).toEqual([]);
    }
  });

  it("stops at the length limit instead of guessing", () => {
    const detail = parseBashStructureDetailed(`echo ${"x".repeat(12_000)}`);
    expect(detail.aborted).toBe(true);
    expect(detail.leaves).toEqual([]);
    // At the limit itself the command is still read: the cap is exclusive.
    const atLimit = `echo ${"x".repeat(MAX_COMMAND_LENGTH - 5)}`;
    expect(atLimit.length).toBe(MAX_COMMAND_LENGTH);
    expect(parseBashStructureDetailed(atLimit).aborted).toBe(false);
  });

  it("counts substitution nesting", () => {
    const nest = (levels: number) =>
      `echo ${"$(echo ".repeat(levels)}hi${")".repeat(levels)}`;
    expect(parseBashStructureDetailed(nest(1)).maxNesting).toBe(1);
    expect(parseBashStructureDetailed(nest(4)).maxNesting).toBe(4);
    const deep = parseBashStructureDetailed(nest(17));
    expect(deep.aborted).toBe(true);
    expect(deep.errors).toContain("too-complex");
    // The depth it reached is still reported: a caller with its own limit can
    // judge it rather than fall open.
    expect(deep.maxNesting).toBe(17);
  });

  it("keeps the fail-closed projection unchanged for data-free commands", () => {
    for (const command of ["git status", "echo hi && ls -la", "rm -rf ../.."]) {
      const detail = parseBashStructureDetailed(command);
      expect(parseBashStructure(command), command).toEqual({
        status: "ok",
        leaves: detail.leaves,
      });
    }
  });

  it("still fails closed on a heredoc, which auto-allow must ask about", () => {
    // Data regions are for the hard gate only: the permission layer keeps
    // asking about heredocs until they are modelled there too.
    for (const command of [
      "cat <<EOF\nhello\nEOF",
      "rm -rf ../.. <<EOF\nx\nEOF",
    ]) {
      expect(parseBashStructure(command), command).toMatchObject({
        status: "unsupported",
        reason: "heredoc",
      });
    }
  });
});

describe("parseBashStructureDetailed — text that is judged a second time", () => {
  /**
   * `eval` and `<(...)` are still unreadable *as commands*, so the auto-allow
   * projection must keep asking. What the detailed walk adds is the material
   * for a caller that judges the text a second time itself.
   */
  it("keeps eval's words and still fails closed on it", () => {
    const quoted = parseBashStructureDetailed("eval 'rm -rf ../..'");
    expect(quoted.errors).toEqual(["eval"]);
    expect(quoted.leaves.map((leaf) => leaf.argv)).toEqual([
      ["eval", "'rm -rf ../..'"],
    ]);
    expect(
      parseBashStructureDetailed("eval rm -rf ../..").leaves[0]!.argv,
    ).toEqual(["eval", "rm", "-rf", "../.."]);
    for (const command of ["eval 'rm -rf ../..'", "eval ls"]) {
      expect(parseBashStructure(command), command).toMatchObject({
        status: "unsupported",
        reason: "eval",
      });
    }
  });

  it("keeps the leaves of a process substitution body", () => {
    const detail = parseBashStructureDetailed("diff <(rm -rf ../..) <(sort b)");
    expect(detail.errors).toEqual([
      "process-substitution",
      "process-substitution",
    ]);
    // Body first, in the order the shell would run them, then the leaf itself.
    expect(detail.leaves.map((leaf) => leaf.argv)).toEqual([
      ["rm", "-rf", "../.."],
      ["sort", "b"],
      ["diff", "<(rm -rf ../..)", "<(sort b)"],
    ]);
    expect(parseBashStructure("cat <(echo hi)")).toMatchObject({
      status: "unsupported",
      reason: "process-substitution",
    });
  });

  it("keeps eval and process substitution from relaxing each other", () => {
    // `trap` has no second reading on our side: it aborts the walk whole, so
    // its leaves are not available to be judged on their own.
    const trap = parseBashStructureDetailed("trap 'rm -rf /' EXIT");
    expect(trap.errors).toEqual(["eval"]);
    expect(trap.leaves).toEqual([]);
    // An arithmetic expansion is still a construct nothing here can read.
    const arithmetic = parseBashStructureDetailed("rm -rf ../.. $((1+2))");
    expect(arithmetic.errors).toEqual(["arithmetic-expansion"]);
    expect(arithmetic.leaves).toEqual([]);
  });
});

describe("parseBashStructureDetailed — assignments", () => {
  it("records a literal write and the leaf index it becomes visible at", () => {
    expect(parseBashStructureDetailed('D=..; rm -rf "$D"').assignments).toEqual(
      [{ visibleFrom: 0, name: "D", value: "..", rhs: ".." }],
    );
    // Quotes do not change the value; the raw text is kept for the card.
    expect(
      parseBashStructureDetailed('D=".."; rm -rf "$D"').assignments,
    ).toEqual([{ visibleFrom: 0, name: "D", value: "..", rhs: '".."' }]);
  });

  it("keeps the right-hand side but no value when it is an expansion", () => {
    // `pwd` is itself a leaf, so the write precedes the `rm` at index 1.
    expect(
      parseBashStructureDetailed('D=$(pwd); rm -rf "$D"').assignments,
    ).toEqual([{ visibleFrom: 1, name: "D", value: null, rhs: "$(pwd)" }]);
  });

  it("reports every write, so a rewritten variable is not taken as pinned", () => {
    const detail = parseBashStructureDetailed('D=a; D=b; rm -rf "$D"');
    expect(detail.assignments.map((write) => write.rhs)).toEqual(["a", "b"]);
  });

  it("places a write after the command written before it", () => {
    expect(
      parseBashStructureDetailed('rm -rf "$D"; D=build').assignments,
    ).toEqual([{ visibleFrom: 1, name: "D", value: "build", rhs: "build" }]);
  });

  it("ignores a prefix assignment, which bash expands with the outer value", () => {
    expect(parseBashStructureDetailed('D=x rm -rf "$D"').assignments).toEqual(
      [],
    );
  });

  it("marks values that come from a loop or a read as unknown", () => {
    expect(
      parseBashStructureDetailed('for f in a b; do rm -rf "$f"; done')
        .assignments,
    ).toEqual([
      { visibleFrom: 0, name: "f", value: null, rhs: "a b", source: "for" },
    ]);
    // Leaf 0 is `read name` itself; the loop body follows it.
    expect(
      parseBashStructureDetailed(
        'while read name; do rm -rf "$name"; done < list',
      ).assignments,
    ).toEqual([
      { visibleFrom: 1, name: "name", value: null, rhs: "", source: "read" },
    ]);
  });

  it("records nothing for a command that assigns nothing", () => {
    expect(parseBashStructureDetailed("rm -rf ../..").assignments).toEqual([]);
  });
});
describe("parseBashStructureDetailed — structures read instead of asked about", () => {
  it("expands a grouping paren to the commands inside it", () => {
    const detail = parseBashStructureDetailed("(cd src && ls); rm -rf build");
    expect(detail.errors).toEqual([]);
    expect(detail.leaves.map((leaf) => leaf.text)).toEqual([
      "cd src",
      "ls",
      "rm -rf build",
    ]);
  });

  it("records the leaf range of a subshell, nested ones included", () => {
    expect(parseBashStructureDetailed("(a; (b; c); d)").subshells).toEqual([
      { start: 0, end: 4 },
      { start: 1, end: 3 },
    ]);
  });

  it("expands a function body and leaves the call an ordinary command", () => {
    const detail = parseBashStructureDetailed("f(){ head -5 x; }; f x");
    expect(detail.errors).toEqual([]);
    expect(detail.leaves.map((leaf) => leaf.text)).toEqual([
      "head -5 x",
      "f x",
    ]);
  });

  it("does not let a function body write look like a write already made", () => {
    // The body runs only when the function is called, so `$D` at the next
    // command is whatever the shell had before — not `build`.
    expect(
      parseBashStructureDetailed('f(){ D=build; }; rm -rf "$D"').assignments,
    ).toEqual([]);
  });

  it("gives a subshell's leaves and writes an id, so neither crosses the paren", () => {
    const detail = parseBashStructureDetailed('(D=x); rm -rf "$D"');
    expect(detail.assignments).toEqual([
      { visibleFrom: 0, name: "D", value: "x", rhs: "x", subshell: 1 },
    ]);
    // The `rm` runs in the shell around the subshell, so it carries no id.
    expect(detail.leaves.map((leaf) => leaf.subshell)).toEqual([undefined]);
  });

  it("resolves a value built from a literal the same line assigns", () => {
    expect(
      parseBashStructureDetailed('V=abc; D=/tmp/$V; rm -rf "$D"').assignments,
    ).toEqual([
      { visibleFrom: 0, name: "V", value: "abc", rhs: "abc" },
      { visibleFrom: 0, name: "D", value: "/tmp/abc", rhs: "/tmp/$V" },
    ]);
  });

  it("keeps heredoc bodies, which a shell would run as a script", () => {
    expect(
      parseBashStructureDetailed("bash <<'EOF'\nrm -rf build\nEOF")
        .heredocBodies,
    ).toEqual(["rm -rf build"]);
    expect(
      parseBashStructureDetailed("git commit -F - <<'MSG'\nmsg\nMSG")
        .heredocBodies,
    ).toEqual(["msg"]);
  });

  it("keeps a quoted here-string word, which reaches the shell on stdin", () => {
    expect(
      parseBashStructureDetailed("sh <<< 'rm -rf /'").heredocBodies,
    ).toEqual(["rm -rf /"]);
  });
});
