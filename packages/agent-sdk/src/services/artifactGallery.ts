/**
 * 创作集（Artifacts 画廊）的账号级读写面。
 *
 * 桌面端「创作集」整页需要的东西全都落在这里：列表（含发布人与分享范围）、
 * 单个创作的分享状态、改分享、撤销发布、普通成员可用的成员检索、以及把预览
 * 窗口里的文件发布成 artifact。宿主（desktop 主进程）不直连网络，它经 stdio
 * RPC 调用本模块（`packages/code/src/stdio/agentBridge.ts` 的 `artifact*` 分支），
 * 这样登录 token 的获取与刷新只留在 CLI 进程一处（同 `artifactList.ts`）。
 *
 * 服务端契约见 docs/specs/desktop/desktop-artifacts.md「外部依赖与服务端补齐」：
 * - `GET /api/frame/frames` 每行带 `ownerEmail` / `shareMode` / `sharedEmails`
 * - `GET /api/enterprise/members/search` 普通成员可用的成员检索（服务端新增）
 * 两者缺席时按「未知」降级（列表仍可用、成员检索报错），不抛异常、不冒充空数据。
 */

import { authService, createAuthAwareFetch } from "./authService.js";
import { logger } from "../utils/globalLogger.js";

const REQUEST_TIMEOUT_MS = 15_000;
/** 与服务端固定页大小一致：列表一次拉满一页（无游标）。 */
const LIST_PAGE_SIZE = 200;

export const ARTIFACT_SHARE_MODES = ["owner", "users", "org"] as const;
export type ArtifactShareMode = (typeof ARTIFACT_SHARE_MODES)[number];

export type ArtifactRel = "mine" | "shared";

/** 列表行（列表页只读这几个字段，不做标题清洗——它是产品文案而不是工具输出）。 */
export interface ArtifactGalleryRow {
  slug: string;
  title: string;
  rel: ArtifactRel;
  updatedAt?: string;
  favicon?: string;
  /** 发布者账号；shared 行是分享者。服务端未返回时缺省。 */
  ownerEmail?: string;
  /** 当前分享范围；shared 行由对方管理，通常缺省。 */
  shareMode?: ArtifactShareMode;
  /** 指定成员账号（shareMode = users 时才有）。 */
  sharedEmails?: string[];
}

export interface ArtifactShareView {
  slug: string;
  version: number;
  title: string;
  mode: ArtifactShareMode;
  pinnedVersion: number | null;
  sharedUsers: Array<{ userId: string; email: string }>;
  versions: Array<{
    version: number;
    label?: string | null;
    title?: string | null;
  }>;
}

export interface ArtifactMember {
  userId: string;
  email: string;
}

export type ArtifactGalleryResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      authRequired?: boolean;
      notFound?: boolean;
      /** 版本冲突（409）：发布时带 `force` 可覆盖。 */
      conflict?: boolean;
    };

function isShareMode(value: unknown): value is ArtifactShareMode {
  return ARTIFACT_SHARE_MODES.includes(value as ArtifactShareMode);
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string" && !!v);
  return out.length > 0 ? out : undefined;
}

/**
 * 统一的带 token 请求：超时、鉴权降级与错误文案只在这里定义一次。
 * 返回 `{ ok:false, authRequired }` 让宿主把它渲染成「请先登录」而不是空列表。
 *
 * 只有 **401** 才代表登录态失效。403 是「已登录但无权做这件事」（例如对
 * 别人分享给你的创作改分享范围）：把它并进 `authRequired` 会让界面弹出登录
 * 入口、把权限问题说成没登录 —— 那是错的提示，所以 403 只作为普通错误文案。
 */
async function request(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ArtifactGalleryResult<unknown>> {
  const serverUrl = authService.getServerUrl();
  const authFetch = createAuthAwareFetch(globalThis.fetch);
  let res: Response;
  try {
    res = await authFetch(`${serverUrl}${path}`, {
      method: init.method ?? "GET",
      headers:
        init.body === undefined
          ? undefined
          : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    logger?.warn("Artifact gallery request failed", {
      path,
      error: String(error),
    });
    return {
      ok: false,
      error: `failed to reach the server: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (res.status === 401) {
    return {
      ok: false,
      error: `authentication failed (HTTP 401)`,
      authRequired: true,
    };
  }
  if (res.status === 403) {
    return { ok: false, error: "没有权限执行该操作（HTTP 403）" };
  }
  if (res.status === 404) {
    return { ok: false, error: "not found", notFound: true };
  }
  if (res.status === 409) {
    const data409 = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const message409 =
      typeof data409.message === "string"
        ? data409.message
        : typeof data409.error === "string"
          ? data409.error
          : "the artifact has been updated by someone else";
    return { ok: false, error: message409, conflict: true };
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const serverMessage =
      typeof data.error === "string" && data.error
        ? data.error
        : `request failed (HTTP ${res.status})`;
    return { ok: false, error: serverMessage };
  }
  return { ok: true, data };
}

function normalizeRow(raw: unknown): ArtifactGalleryRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (row.softDeleted === true) return null;
  const rel = row.rel;
  if (rel !== "mine" && rel !== "shared") return null;
  const slug = typeof row.slug === "string" ? row.slug.trim() : "";
  if (!slug) return null;

  const normalized: ArtifactGalleryRow = {
    slug,
    title: typeof row.title === "string" && row.title ? row.title : "Untitled",
    rel,
  };
  if (typeof row.updatedAt === "string" && row.updatedAt) {
    normalized.updatedAt = row.updatedAt;
  }
  if (typeof row.favicon === "string" && row.favicon) {
    normalized.favicon = row.favicon;
  }
  // 发布人 / 分享范围是本期新增的服务端字段：缺席就留空，由前端降级成「—」。
  if (typeof row.ownerEmail === "string" && row.ownerEmail) {
    normalized.ownerEmail = row.ownerEmail;
  }
  if (isShareMode(row.shareMode)) {
    normalized.shareMode = row.shareMode;
  }
  const sharedEmails = asStringArray(row.sharedEmails);
  if (sharedEmails) normalized.sharedEmails = sharedEmails;
  return normalized;
}

/** 列表：一次拉服务端固定页（200），不分页、不游标（spec 非目标）。 */
export async function fetchArtifactGalleryList(): Promise<
  ArtifactGalleryResult<{ rows: ArtifactGalleryRow[] }>
> {
  const result = await request(`/api/frame/frames?limit=${LIST_PAGE_SIZE}`);
  if (!result.ok) return result;
  const data = result.data as Record<string, unknown>;
  if (!Array.isArray(data.frames)) {
    return { ok: false, error: "malformed response: no frames array" };
  }
  const rows = (data.frames as unknown[])
    .map(normalizeRow)
    .filter((row): row is ArtifactGalleryRow => row !== null);
  return { ok: true, data: { rows } };
}

/** 单个创作的分享状态（拥有者专用；弹层回显的唯一来源）。 */
export async function fetchArtifactShareView(
  slug: string,
): Promise<ArtifactGalleryResult<ArtifactShareView>> {
  const result = await request(`/api/frame/${encodeURIComponent(slug)}/view`);
  if (!result.ok) return result;
  const data = result.data as Record<string, unknown>;
  const perm = (data.perm ?? {}) as Record<string, unknown>;
  if (!isShareMode(perm.mode)) {
    return { ok: false, error: "malformed response: perm.mode" };
  }
  const sharedUsers = Array.isArray(data.sharedUsers)
    ? (data.sharedUsers as unknown[])
        .map((entry) => {
          if (typeof entry !== "object" || entry === null) return null;
          const row = entry as Record<string, unknown>;
          if (typeof row.userId !== "string" || typeof row.email !== "string") {
            return null;
          }
          return { userId: row.userId, email: row.email };
        })
        .filter((u): u is { userId: string; email: string } => u !== null)
    : [];
  const versions = Array.isArray(data.versions)
    ? (data.versions as unknown[])
        .map((entry) => {
          if (typeof entry !== "object" || entry === null) return null;
          const row = entry as Record<string, unknown>;
          const version = Number(row.version);
          if (!Number.isFinite(version)) return null;
          return {
            version,
            label: typeof row.label === "string" ? row.label : null,
            title: typeof row.title === "string" ? row.title : null,
          };
        })
        .filter(
          (
            v,
          ): v is {
            version: number;
            label: string | null;
            title: string | null;
          } => v !== null,
        )
    : [];
  const pinned = data.pinnedVersion;
  return {
    ok: true,
    data: {
      slug,
      version: Number(data.version) || 1,
      title: typeof data.title === "string" ? data.title : "",
      mode: perm.mode,
      pinnedVersion: typeof pinned === "number" ? pinned : null,
      sharedUsers,
      versions,
    },
  };
}

/** 保存分享范围（拥有者专用）。模式语义与 `POST /api/frame/{slug}/share` 一致。 */
export async function saveArtifactShare(input: {
  slug: string;
  mode: ArtifactShareMode;
  userIds?: string[];
  pinnedVersion?: number | null;
}): Promise<ArtifactGalleryResult<{ userIds: string[] }>> {
  const body: Record<string, unknown> = { mode: input.mode };
  if (input.mode === "users") body.userIds = input.userIds ?? [];
  if (input.pinnedVersion !== undefined) {
    body.pinnedVersion = input.pinnedVersion;
  }
  const result = await request(
    `/api/frame/${encodeURIComponent(input.slug)}/share`,
    { method: "POST", body },
  );
  if (!result.ok) return result;
  const data = result.data as Record<string, unknown>;
  const userIds = asStringArray(data.userIds) ?? [];
  return { ok: true, data: { userIds } };
}

/** 撤销发布：删除该 slug 的发布记录，不动本地文件。 */
export async function revokeArtifact(
  slug: string,
): Promise<ArtifactGalleryResult<Record<string, never>>> {
  const result = await request(`/api/frame/${encodeURIComponent(slug)}`, {
    method: "DELETE",
  });
  if (!result.ok) return result;
  return { ok: true, data: {} };
}

/** 成员检索（本企业 active 成员，按邮箱模糊；`search` 为空时给首批）。 */
export async function searchArtifactMembers(
  search: string,
  limit = 20,
): Promise<ArtifactGalleryResult<{ members: ArtifactMember[] }>> {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  params.set("limit", String(limit));
  const result = await request(`/api/enterprise/members/search?${params}`);
  if (!result.ok) return result;
  const data = result.data as Record<string, unknown>;
  if (!Array.isArray(data.members)) {
    return { ok: false, error: "malformed response: no members array" };
  }
  const members = (data.members as unknown[])
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const row = entry as Record<string, unknown>;
      if (typeof row.userId !== "string" || typeof row.email !== "string") {
        return null;
      }
      return { userId: row.userId, email: row.email };
    })
    .filter((m): m is ArtifactMember => m !== null);
  return { ok: true, data: { members } };
}

/** 发布结果：成功给出可分享的链接与 slug。 */
export interface ArtifactPublishResult {
  url: string;
  slug: string;
  version: number;
}

/**
 * 把一份 HTML 发布成 artifact（预览窗口的「发布」按钮走这条路）。
 *
 * 与 `Artifact` 工具的 `publish` 同一条服务端接口与同一种载荷；没有 PreToolUse
 * 权限闸（用户在预览面板上主动点的按钮）。`url` / `baseVersion` 由宿主从上一次
 * 发布记录里带下来——同一个本地文件重复发布应当更新同一条创作（新版本），
 * 而不是每次新建（spec 场景 3）；服务端版本冲突（409）作为可操作错误返回。
 */
export async function publishArtifactHtml(input: {
  html: string;
  title?: string;
  favicon?: string;
  url?: string;
  baseVersion?: number;
  force?: boolean;
}): Promise<ArtifactGalleryResult<ArtifactPublishResult>> {
  const body: Record<string, unknown> = {
    content: input.html,
    favicon: input.favicon ?? "📄",
  };
  if (input.title) body.title = input.title;
  if (input.url) body.url = input.url;
  if (input.baseVersion !== undefined) body.baseVersion = input.baseVersion;
  if (input.force) body.force = true;
  const result = await request("/api/frame/deploy/direct", {
    method: "POST",
    body,
  });
  if (!result.ok) return result;
  const data = result.data as Record<string, unknown>;
  const url = typeof data.url === "string" ? data.url : "";
  const slug = typeof data.slug === "string" ? data.slug : "";
  if (!url || !slug) {
    return { ok: false, error: "malformed response: url/slug" };
  }
  return { ok: true, data: { url, slug, version: Number(data.version) || 1 } };
}
