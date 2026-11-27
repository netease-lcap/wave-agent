/**
 * 仓库远端托管方 —— 照 CC 的 `TA()`（`0105-1092B-aSt.js:18`）。
 *
 * 放在 utils 而不是某个技能里：CC 里同一个判定至少有四处调用点 —— `/code-review`
 * 的评审目标（`1091-228433B-Vdr.js:2003`）、建议提示「GitLab/Bitbucket 仓库不提
 * install-github-app」（`2613-56718B-…js:1181`）与「同上不提 /web-setup」（同文件
 * :1390）、gh 安装状态里的 `mayBeGitHubEnterprise`（`2806-158586B-Eyd.js:2794`）。
 * 所以「这个仓库托管在哪」是跨技能的事实，不是哪一家的私有判据。
 *
 * 只认三家公共云；自建实例（GHES、自托管 GitLab）一律 `other` —— CC 也不把自建
 * GitLab 当 GitLab 处理，`glab` 对自建实例的行为不由它保证。
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
  const host = normalizeHost(raw);
  const alias = SSH_HOST_ALIASES[host];
  if (alias) return alias;
  if (host === "github.com") return "github";
  if (host === "gitlab.com") return "gitlab";
  if (host === "bitbucket.org") return "bitbucket";
  return "other";
}
