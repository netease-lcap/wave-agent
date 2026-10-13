import { describe, it, expect } from "vitest";
import {
  DEEP_LINK_SCHEME,
  MAX_DEEP_LINK_LENGTH,
  findDeepLink,
  isSupportedRepoUrl,
  isValidRef,
  parseCloneDeepLink,
  repoDirectoryName,
} from "../src/main/deepLink";

/** What `sdd` sends: `wave://clone?repo=…&ref=…&prompt=…`. */
function cloneLink(params: Record<string, string>): string {
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `${DEEP_LINK_SCHEME}://clone?${query}`;
}

describe("parseCloneDeepLink", () => {
  it("parses repo / ref / prompt", () => {
    const link = parseCloneDeepLink(
      cloneLink({
        repo: "https://git.example.com/team/repo.git",
        ref: "feature/spec-draft",
        prompt: "实现 spec",
      }),
    );
    expect(link).toEqual({
      action: "clone",
      repo: "https://git.example.com/team/repo.git",
      ref: "feature/spec-draft",
      prompt: "实现 spec",
    });
  });

  it("不读凭据字段：链接里带 token 也只是被忽略的未知参数", () => {
    const link = parseCloneDeepLink(
      cloneLink({
        repo: "https://git.example.com/team/repo.git",
        prompt: "实现 spec",
        token: "eyJhbGciOi.test.token",
      }),
    );
    // 认证只能用本机已有的登录态，所以凭据字段连解析都不该被读进来。
    expect(link).toEqual({
      action: "clone",
      repo: "https://git.example.com/team/repo.git",
      prompt: "实现 spec",
    });
    expect("token" in link).toBe(false);
  });

  it("omits ref / prompt when absent or empty", () => {
    const base = { repo: "https://git.example.com/team/repo.git" };
    expect(parseCloneDeepLink(cloneLink(base))).toEqual({
      action: "clone",
      repo: base.repo,
    });
    expect(
      parseCloneDeepLink(cloneLink({ ...base, ref: "", prompt: "" })),
    ).toEqual({ action: "clone", repo: base.repo });
  });

  it("keeps free text intact: `&`, `+`, `#`, newlines and percent signs", () => {
    const prompt = "实现 spec a&b+c#d\nline2 100% 完成";
    const parsed = parseCloneDeepLink(
      cloneLink({ repo: "https://git.example.com/t/r.git", prompt }),
    );
    expect(parsed.prompt).toBe(prompt);
  });

  it("keeps a literal `+` that a sender encoded as %2B (not a space)", () => {
    const parsed = parseCloneDeepLink(
      `wave://clone?repo=https%3A%2F%2Fg.com%2Fa%2Fr.git&prompt=a%2Bb+c`,
    );
    expect(parsed.prompt).toBe("a+b c");
  });

  it("degrades to the raw text on a malformed percent escape", () => {
    const parsed = parseCloneDeepLink(
      "wave://clone?repo=https://g.com/a/r.git&prompt=100%完成",
    );
    expect(parsed.prompt).toBe("100%完成");
  });

  it("accepts the `wave:///clone` form (path instead of authority)", () => {
    const parsed = parseCloneDeepLink(
      "wave:///clone?repo=https://g.com/a/r.git&prompt=go",
    );
    expect(parsed.repo).toBe("https://g.com/a/r.git");
    expect(parsed.prompt).toBe("go");
  });

  it("strips the quotes Windows may leave around the URL", () => {
    const parsed = parseCloneDeepLink(
      '"wave://clone?repo=https://g.com/a/r.git"',
    );
    expect(parsed.repo).toBe("https://g.com/a/r.git");
  });

  it("rejects a missing repo, an unknown action and another protocol", () => {
    expect(() => parseCloneDeepLink("wave://clone?ref=main")).toThrow(
      /缺少仓库地址/,
    );
    expect(() =>
      parseCloneDeepLink("wave://open?repo=https://g.com/a/r.git"),
    ).toThrow(/不支持的唤起动作/);
    expect(() =>
      parseCloneDeepLink("http://clone?repo=https://g.com/a/r.git"),
    ).toThrow(/不支持的协议/);
  });

  it("rejects a malformed ref but allows slashes and dots", () => {
    expect(() =>
      parseCloneDeepLink(
        cloneLink({ repo: "https://g.com/a/r.git", ref: "release/1.2.x" }),
      ),
    ).not.toThrow();
    expect(() =>
      parseCloneDeepLink(
        cloneLink({ repo: "https://g.com/a/r.git", ref: "bad ref" }),
      ),
    ).toThrow(/分支名非法/);
  });

  it("rejects a link over the Windows-safe length budget", () => {
    const link = cloneLink({
      repo: "https://g.com/a/r.git",
      prompt: "x".repeat(MAX_DEEP_LINK_LENGTH + 1),
    });
    expect(link.length).toBeGreaterThan(MAX_DEEP_LINK_LENGTH);
    expect(() => parseCloneDeepLink(link)).toThrow(/链接过长/);
  });

  it("measures the budget on the encoded length, not the decoded one", () => {
    // 中文单字编码后约 9 字符：120 字 = 1080 > 1000，未编码时只有 120。
    const prompt = "实现规格说明".repeat(20);
    const link = cloneLink({ repo: "https://g.com/a/r.git", prompt });
    expect(link.length).toBeGreaterThan(MAX_DEEP_LINK_LENGTH);
    expect(() => parseCloneDeepLink(link)).toThrow(/链接过长/);
  });
});

describe("findDeepLink", () => {
  it("finds the link without relying on its position in argv", () => {
    const args = [
      "/Applications/CodeWave IDE.app/Contents/MacOS/CodeWave IDE",
      "--some-chromium-switch",
      "wave://clone?repo=https://g.com/a/r.git",
    ];
    expect(findDeepLink(args)).toBe("wave://clone?repo=https://g.com/a/r.git");
  });

  it("ignores non-matching argv entries", () => {
    expect(findDeepLink(["/path/to/exe", "--flag"])).toBeUndefined();
    expect(findDeepLink([])).toBeUndefined();
  });

  it("matches the scheme case-insensitively and returns it normalized", () => {
    expect(findDeepLink(['"WAVE://clone?repo=https://g.com/a/r.git"'])).toBe(
      "WAVE://clone?repo=https://g.com/a/r.git",
    );
  });
});

describe("isSupportedRepoUrl", () => {
  it("accepts http(s), ssh and scp-like addresses", () => {
    expect(isSupportedRepoUrl("https://g.com/a/r.git")).toBe(true);
    expect(isSupportedRepoUrl("http://g.com:8080/a/r")).toBe(true);
    expect(isSupportedRepoUrl("ssh://git@g.com:2222/a/r.git")).toBe(true);
    expect(isSupportedRepoUrl("git@g.com:a/r.git")).toBe(true);
  });

  it("rejects local paths, file:// and git://", () => {
    expect(isSupportedRepoUrl("/Users/me/repo")).toBe(false);
    expect(isSupportedRepoUrl("file:///Users/me/repo")).toBe(false);
    expect(isSupportedRepoUrl("git://g.com/a/r.git")).toBe(false);
    expect(isSupportedRepoUrl("https://")).toBe(false);
  });

  it("rejects a password in the URL, which git would persist to .git/config", () => {
    expect(isSupportedRepoUrl("https://user:pass@g.com/a/r.git")).toBe(false);
    expect(isSupportedRepoUrl("ssh://user:pass@g.com/a/r.git")).toBe(false);
    expect(isSupportedRepoUrl("user:pass@g.com:a/r.git")).toBe(false);
    // A bare username is legitimate (ssh needs `git@`), and `host:port` is not
    // userinfo at all.
    expect(isSupportedRepoUrl("https://user@g.com/a/r.git")).toBe(true);
    expect(isSupportedRepoUrl("https://g.com:8443/a/r.git")).toBe(true);
  });
});

describe("isValidRef", () => {
  it("accepts ordinary branch and tag names", () => {
    expect(isValidRef("main")).toBe(true);
    expect(isValidRef("release/1.2.x")).toBe(true);
    expect(isValidRef("v1.2.3")).toBe(true);
  });

  it("rejects option-looking and malformed refs", () => {
    expect(isValidRef("")).toBe(false);
    expect(isValidRef("-x")).toBe(false);
    expect(isValidRef(".hidden")).toBe(false);
    expect(isValidRef("a..b")).toBe(false);
    expect(isValidRef("a b")).toBe(false);
    expect(isValidRef("a~1")).toBe(false);
    expect(isValidRef("a^")).toBe(false);
    expect(isValidRef("a//b")).toBe(false);
    expect(isValidRef("a/")).toBe(false);
    expect(isValidRef("a.lock")).toBe(false);
    expect(isValidRef("x".repeat(256))).toBe(false);
  });
});

describe("repoDirectoryName", () => {
  it("derives the directory name from the repository address", () => {
    expect(repoDirectoryName("https://g.com/team/repo.git")).toBe("repo");
    expect(repoDirectoryName("https://g.com/team/repo")).toBe("repo");
    expect(repoDirectoryName("git@g.com:team/repo.git")).toBe("repo");
    expect(repoDirectoryName("https://g.com/team/repo.git/")).toBe("repo");
  });

  it("returns an empty name when nothing usable is left", () => {
    expect(repoDirectoryName("https://g.com/a/.git")).toBe("");
    expect(repoDirectoryName("https://g.com/a/..")).toBe("");
  });
});
