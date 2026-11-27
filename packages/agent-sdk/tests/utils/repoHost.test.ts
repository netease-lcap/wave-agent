import { describe, it, expect } from "vitest";
import { repoHostOf } from "../../src/utils/repoHost.js";

// 远端地址是手写的，所以判定要能吃下真实世界里会出现的各种写法。表里的每个
// 形态都对应 CC 的 `TA()`（`0105-1092B-aSt.js:18`）与它的归一 `jJt()`
// （`0088-2037B-Nva.js:30`）能处理的输入。
describe("repoHostOf", () => {
  it("names the three public hosts from either URL shape", () => {
    for (const url of [
      "https://github.com/o/r.git",
      "git@github.com:o/r.git",
      "ssh://git@github.com/o/r.git",
    ]) {
      expect(repoHostOf(url)).toBe("github");
    }
    expect(repoHostOf("git@gitlab.com:g/p.git")).toBe("gitlab");
    expect(repoHostOf("https://bitbucket.org/t/r.git")).toBe("bitbucket");
  });

  it("ignores case, a port and a www prefix", () => {
    expect(repoHostOf("https://GitHub.com:443/o/r.git")).toBe("github");
    expect(repoHostOf("https://www.gitlab.com/g/p.git")).toBe("gitlab");
  });

  // SSH 端口转发用的别名域名，CC 的 `o` 表（`0105-1092B-aSt.js:19`）。
  it("knows the ssh alias hosts", () => {
    expect(repoHostOf("git@ssh.github.com:o/r.git")).toBe("github");
    expect(repoHostOf("git@altssh.gitlab.com:g/p.git")).toBe("gitlab");
    expect(repoHostOf("git@altssh.bitbucket.org:t/r.git")).toBe("bitbucket");
  });

  // 自建实例（GHES、自托管 GitLab）在 CC 里也是 other：gh / glab 对它们的行为
  // 不由 CC 保证，所以调用方只能按「不知道」处理，不能偷偷当成公共云。
  it("treats self-hosted instances as other", () => {
    expect(repoHostOf("https://gitlab.example.com/g/p.git")).toBe("other");
    expect(repoHostOf("git@ghe.corp:o/r.git")).toBe("other");
  });

  it("gives nothing when there is no usable remote", () => {
    for (const url of [null, undefined, "", "   ", "C:/repo"]) {
      expect(repoHostOf(url)).toBeUndefined();
    }
  });
});
