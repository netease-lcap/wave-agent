/**
 * 仓库远端托管方 —— 照 CC 的 `TA()`（`0105-1092B-aSt.js:18`）。
 *
 * 放在 utils 而不是某个技能里：CC 里同一个判定至少有四处调用点 —— `/code-review`
 * 的评审目标（`1091-228433B-Vdr.js:2003`）、建议提示「GitLab/Bitbucket 仓库不提
 * install-github-app」（`2613-56718B-…js:1181`）与「同上不提 /web-setup」（同文件
 * :1390）、gh 安装状态里的 `mayBeGitHubEnterprise`（`2806-158586B-Eyd.js:2794`）。
 * 所以「这个仓库托管在哪」是跨技能的事实，不是哪一家的私有判据。
 *
 * 只认三家公共云；自建实例（GHES、自托管 GitLab）一律 `other` —— 这是**事实**，
 * 不是结论。写命令行时该用哪家 CLI，由 `repoPlatformOf()` 在它之上再折一层：自建
 * 实例按私有化部署的 GitLab 处理（国内客户基本都是自建 GitLab、GitHub 不可达，
 * 判定不出时猜 GitLab 比猜 GitHub 命中率高得多）。
 */
export type RepoHost = "github" | "gitlab" | "bitbucket" | "other";

/** CC 的 `o`：SSH 端口转发用的别名域名（`0105-1092B-aSt.js:19`）。 */
const SSH_HOST_ALIASES: Record<string, RepoHost> = {
  "ssh.github.com": "github",
  "altssh.gitlab.com": "gitlab",
  "altssh.bitbucket.org": "bitbucket",
};

/**
 * 从 remote URL 里取 host，照 CC 的 `noe()`（`0105-1092B-aSt.js:32`）。
 *
 * 两种形态：带 scheme 的（`https://` / `ssh://`）交给 `new URL`；不带 scheme 的走
 * `user@host:path`。取到的 host 不含端口（`TA()` 开头自己去了端口）。
 */
function hostFromRemote(remoteUrl: string): string | undefined {
  const url = remoteUrl.trim();
  if (url.includes("://")) {
    try {
      return new URL(url).hostname || undefined;
    } catch {
      return undefined;
    }
  }
  const scp = /^(?:[^@/]+@)?([^:/]+):/.exec(url)?.[1];
  // 盘符路径（`C:/repo`）也匹配上面那条，靠「必须像域名」挡掉。
  return scp && scp.includes(".") ? scp : undefined;
}

/** CC 的 `CD()` + `jJt()`：小写、去端口、去前缀 `www.`（`0088-2037B-Nva.js:30`）。 */
function normalizeHost(host: string): string {
  let normalized = host.trim().toLowerCase().replace(/:\d+$/, "");
  while (normalized.startsWith("www.")) normalized = normalized.slice(4);
  return normalized;
}

/**
 * 已取出的主机名归到托管方，照 CC 的 `TA()`（`0105-1092B-aSt.js:18`）。
 *
 * 与 `repoHostOf()` 拆开是为了「手上已经有一个主机名」的调用方：`/code-review`
 * 要判目标串里的 PR 链接指向哪家（`1091-228433B-Vdr.js:2016` 的 `TA(h)`），拿到的
 * 是 URL 里的 host，不是 remote。
 */
export function repoHostOfHost(host: string): RepoHost {
  const normalized = normalizeHost(host);
  const alias = SSH_HOST_ALIASES[normalized];
  if (alias) return alias;
  if (normalized === "github.com") return "github";
  if (normalized === "gitlab.com") return "gitlab";
  if (normalized === "bitbucket.org") return "bitbucket";
  return "other";
}

/**
 * 远端托管方；没配远端、或 URL 认不出 host 时返回 `undefined`。
 *
 * 调用方据此退回「不知道」的处理：`/code-review` 就按 GitHub PR 处理，而不是瞎猜。
 */
export function repoHostOf(
  remoteUrl: string | null | undefined,
): RepoHost | undefined {
  if (!remoteUrl) return undefined;
  const raw = hostFromRemote(remoteUrl);
  if (!raw) return undefined;
  return repoHostOfHost(raw);
}

/** 写命令行时认的平台：三家公共云。自建实例由 `repoPlatformOf()` 折成 GitLab。 */
export type CliPlatform = Exclude<RepoHost, "other">;

/**
 * 写命令行时用的平台：在 `repoHostOf()` 的事实之上加一层部署形态的默认值。
 *
 * 公网三家照实返回；自建实例（`other`）一律当私有化部署的 GitLab —— 国内客户的
 * 私有化部署基本都是自建 GitLab（GitHub 不可达、GHES 极少）。没配远端 / 地址认不出
 * 仍返回 `undefined`：那是真的不知道，调用方该保持「不注入」，而不是编一条可能指向
 * 别处的命令。
 *
 * 已知取舍：自建 GitHub Enterprise 会被同样当成 GitLab，裸数字走 `glab`。显式写
 * `!12` 或整条链接的人不受影响（那两个按写法就能判，不靠这里的默认值）。
 */
export function repoPlatformOf(
  remoteUrl: string | null | undefined,
): CliPlatform | undefined {
  const host = repoHostOf(remoteUrl);
  return host === "other" ? "gitlab" : host;
}
