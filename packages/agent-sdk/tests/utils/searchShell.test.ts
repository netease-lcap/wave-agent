import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { buildSearchShellPrelude } from "../../src/utils/searchShell.js";

const TOOLS = { ugrep: "/pkg/bin/ugrep", bfs: "/pkg/bin/bfs" };
const RG = "/pkg/bin/rg";

describe("buildSearchShellPrelude", () => {
  it("shadows grep and find on macOS/Linux, and offers rg", () => {
    const prelude = buildSearchShellPrelude({
      platform: "linux",
      tools: TOOLS,
      rgPath: RG,
    });

    expect(prelude).toContain("function grep {");
    expect(prelude).toContain("function find {");
    expect(prelude).toContain("command -v rg");
    expect(prelude).toContain("/pkg/bin/rg");
  });

  it("injects the Grep tool's file filtering into grep", () => {
    const prelude = buildSearchShellPrelude({
      platform: "linux",
      tools: TOOLS,
    })!;

    // -G keeps GNU BRE semantics (`\|` is alternation); the rest reproduces what
    // the Grep tool asks ripgrep for: gitignore, hidden files, no binaries, and
    // the VCS dirs excluded.
    expect(prelude).toContain("'-G'");
    expect(prelude).toContain("'--ignore-files'");
    expect(prelude).toContain("'--hidden'");
    expect(prelude).toContain("'-I'");
    expect(prelude).toContain("'--exclude-dir=.git'");
    expect(prelude).toContain("'--exclude-dir=.svn'");
  });

  it("falls back to the system grep for flags ugrep cannot honour", () => {
    const prelude = buildSearchShellPrelude({
      platform: "linux",
      tools: TOOLS,
    })!;

    // Pipeline-breaking output formats...
    expect(prelude).toContain("--null");
    expect(prelude).toContain("--null-data");
    expect(prelude).toContain("-[Zz]*");
    // ...and the flags that reach outside the process.
    expect(prelude).toContain("-*-filter*");
    expect(prelude).toContain("-*-config*");
    expect(prelude).toContain("-@*");
    // Each match must run the *system* command, not this function again.
    expect(prelude).toContain("command grep");
  });

  it("gives find GNU find's default regex flavour", () => {
    const prelude = buildSearchShellPrelude({
      platform: "linux",
      tools: TOOLS,
    })!;

    // DFS keeps the traversal order predictable...
    expect(prelude).toContain("'-S' 'dfs'");
    // ...and bfs's own default is POSIX BRE, where `\|` is a literal pipe while
    // GNU find's emacs flavour treats it as alternation. Without this,
    // `find . -regex '.*\.\(js\|ts\)'` silently returns nothing.
    expect(prelude).toContain("'-regextype' 'findutils-default'");
    // No deny list on find: bfs carries Oniguruma, so -regex stays inside it.
    expect(prelude).not.toContain("-regex|-regextype");
  });

  it("shadows grep on Windows, but never find", () => {
    // Windows needs the grep shadow as much as macOS: msys ships GNU grep,
    // which has no .gitignore support, so `dist/`, `node_modules/` and sibling
    // worktrees all end up in the results. `find` is the opposite case — there
    // is no Windows bfs and msys find already is GNU find.
    const prelude = buildSearchShellPrelude({
      platform: "win32",
      tools: { ugrep: "C:\\pkg\\ugrep.exe", bfs: "C:\\pkg\\bfs.exe" },
      rgPath: "C:\\pkg\\rg.exe",
    })!;

    expect(prelude).toContain("function grep {");
    expect(prelude).not.toContain("function find {");
    expect(prelude).toContain("command -v rg");
    // Windows paths reach bash with forward slashes, which git bash accepts.
    expect(prelude).toContain("C:/pkg/ugrep.exe");
    expect(prelude).toContain("C:/pkg/rg.exe");
  });

  it("shadows whichever binaries are actually installed", () => {
    const onlyBfs = buildSearchShellPrelude({
      platform: "linux",
      tools: { bfs: "/pkg/bin/bfs" },
    })!;
    expect(onlyBfs).not.toContain("function grep {");
    expect(onlyBfs).toContain("function find {");

    const onlyUgrep = buildSearchShellPrelude({
      platform: "linux",
      tools: { ugrep: "/pkg/bin/ugrep" },
    })!;
    expect(onlyUgrep).toContain("function grep {");
    expect(onlyUgrep).not.toContain("function find {");
  });

  it("returns undefined when there is nothing to inject", () => {
    expect(
      buildSearchShellPrelude({
        platform: "linux",
        tools: {},
        rgPath: undefined,
      }),
    ).toBeUndefined();
    expect(
      buildSearchShellPrelude({
        platform: "linux",
        tools: undefined,
        rgPath: undefined,
      }),
    ).toBeUndefined();
  });

  it("quotes a path containing a single quote", () => {
    const prelude = buildSearchShellPrelude({
      platform: "linux",
      tools: { ugrep: "/opt/it's here/ugrep" },
    })!;

    expect(prelude).toContain(`'/opt/it'"'"'s here/ugrep'`);
  });

  it.skipIf(process.platform === "win32")("is valid bash", () => {
    const prelude = buildSearchShellPrelude({
      platform: "linux",
      tools: TOOLS,
      rgPath: RG,
    })!;

    expect(() =>
      execFileSync("bash", ["-n"], { input: prelude }),
    ).not.toThrow();
  });
});
