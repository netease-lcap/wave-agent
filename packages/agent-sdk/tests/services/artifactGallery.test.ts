import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("../../src/services/authService.js", () => ({
  authService: {
    getServerUrl: vi.fn(),
    getSSOToken: vi.fn(),
  },
  createAuthAwareFetch: vi.fn((innerFetch: typeof fetch) => innerFetch),
}));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { authService } from "../../src/services/authService.js";
import {
  fetchArtifactGalleryList,
  fetchArtifactShareView,
  publishArtifactHtml,
  revokeArtifact,
  saveArtifactShare,
  searchArtifactMembers,
} from "../../src/services/artifactGallery.js";

const SERVER_URL = "https://server.test";

function jsonResponse(status: number, body: unknown): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

let fetchMock: Mock;

beforeEach(() => {
  (authService.getServerUrl as Mock).mockReturnValue(SERVER_URL);
  (authService.getSSOToken as Mock).mockReturnValue("token");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const lastCall = () => fetchMock.mock.calls.at(-1) as [string, RequestInit];
const lastBody = () => JSON.parse(lastCall()[1].body as string);

describe("fetchArtifactGalleryList", () => {
  it("maps rows and keeps the owner / share fields the gallery columns need", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        frames: [
          {
            slug: "a1",
            title: "报表",
            rel: "mine",
            updatedAt: "2026-10-20T10:00:00Z",
            favicon: "📊",
            ownerEmail: "me@corp.com",
            shareMode: "users",
            sharedEmails: ["x@corp.com", "y@corp.com"],
          },
          {
            slug: "b2",
            title: "同事的原型",
            rel: "shared",
            ownerEmail: "peer@corp.com",
          },
        ],
      }),
    );

    const result = await fetchArtifactGalleryList();

    expect(lastCall()[0]).toBe(`${SERVER_URL}/api/frame/frames?limit=200`);
    expect(result).toEqual({
      ok: true,
      data: {
        rows: [
          {
            slug: "a1",
            title: "报表",
            rel: "mine",
            updatedAt: "2026-10-20T10:00:00Z",
            favicon: "📊",
            ownerEmail: "me@corp.com",
            shareMode: "users",
            sharedEmails: ["x@corp.com", "y@corp.com"],
          },
          {
            slug: "b2",
            title: "同事的原型",
            rel: "shared",
            ownerEmail: "peer@corp.com",
          },
        ],
      },
    });
  });

  it("drops soft-deleted / malformed rows instead of rendering blanks", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        frames: [
          { slug: "gone", rel: "mine", softDeleted: true },
          { rel: "mine" },
          { slug: "kept", rel: "mine" },
        ],
      }),
    );

    const result = await fetchArtifactGalleryList();

    expect(result).toEqual({
      ok: true,
      data: { rows: [{ slug: "kept", title: "Untitled", rel: "mine" }] },
    });
  });

  it("keeps an unknown shareMode absent rather than inventing 「仅自己」", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        frames: [{ slug: "s", rel: "mine", shareMode: "weird" }],
      }),
    );

    const result = await fetchArtifactGalleryList();

    expect(result.ok && result.data.rows[0]).not.toHaveProperty("shareMode");
  });

  it("reports 401 as authRequired (never as an empty list)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, {}));

    const result = await fetchArtifactGalleryList();

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.authRequired).toBe(true);
  });

  it("reports 403 as a permission error, not as a login problem", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, {}));

    const result = await fetchArtifactGalleryList();

    expect(result.ok).toBe(false);
    // 403 = 已登录但无权：不能弹登录入口（那会把权限问题说成没登录）。
    expect(result.ok === false && result.authRequired).toBeFalsy();
    expect(result.ok === false && result.error).toBe(
      "没有权限执行该操作（HTTP 403）",
    );
  });
});

describe("fetchArtifactShareView", () => {
  it("reads mode / pinnedVersion / members / versions from /view", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        slug: "a1",
        version: 4,
        title: "报表",
        perm: { mode: "users" },
        pinnedVersion: 2,
        sharedUsers: [{ userId: "u1", email: "x@corp.com" }, { junk: true }],
        versions: [{ version: 3, label: "v3" }, { version: "bad" }],
      }),
    );

    const result = await fetchArtifactShareView("a1");

    expect(lastCall()[0]).toBe(`${SERVER_URL}/api/frame/a1/view`);
    expect(result).toEqual({
      ok: true,
      data: {
        slug: "a1",
        version: 4,
        title: "报表",
        mode: "users",
        pinnedVersion: 2,
        sharedUsers: [{ userId: "u1", email: "x@corp.com" }],
        versions: [{ version: 3, label: "v3", title: null }],
      },
    });
  });

  it("fails loudly when the server omits perm.mode", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { slug: "a1" }));

    const result = await fetchArtifactShareView("a1");

    expect(result.ok).toBe(false);
  });
});

describe("saveArtifactShare", () => {
  it("sends userIds only for the users mode and keeps pinnedVersion", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { userIds: ["u1", "u2"] }));

    const result = await saveArtifactShare({
      slug: "a1",
      mode: "users",
      userIds: ["u1", "u2"],
      pinnedVersion: 3,
    });

    expect(lastCall()[0]).toBe(`${SERVER_URL}/api/frame/a1/share`);
    expect(lastCall()[1].method).toBe("POST");
    expect(lastBody()).toEqual({
      mode: "users",
      userIds: ["u1", "u2"],
      pinnedVersion: 3,
    });
    expect(result).toEqual({ ok: true, data: { userIds: ["u1", "u2"] } });
  });

  it("omits userIds for the org mode", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await saveArtifactShare({ slug: "a1", mode: "org" });

    expect(lastBody()).toEqual({ mode: "org" });
  });

  it("maps 404 to notFound (the row was revoked elsewhere)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, {}));

    const result = await saveArtifactShare({ slug: "a1", mode: "owner" });

    expect(result.ok === false && result.notFound).toBe(true);
  });
});

describe("revokeArtifact", () => {
  it("DELETEs the slug", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    const result = await revokeArtifact("a1");

    expect(lastCall()[0]).toBe(`${SERVER_URL}/api/frame/a1`);
    expect(lastCall()[1].method).toBe("DELETE");
    expect(result).toEqual({ ok: true, data: {} });
  });
});

describe("searchArtifactMembers", () => {
  it("passes the keyword and limit, and filters malformed members", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        members: [{ userId: "u1", email: "x@corp.com" }, { userId: "u2" }],
      }),
    );

    const result = await searchArtifactMembers("  x  ", 5);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${SERVER_URL}/api/enterprise/members/search?search=x&limit=5`,
    );
    expect(result).toEqual({
      ok: true,
      data: { members: [{ userId: "u1", email: "x@corp.com" }] },
    });
  });

  it("omits search when the keyword is blank (first page of members)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { members: [] }));

    await searchArtifactMembers("   ");

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${SERVER_URL}/api/enterprise/members/search?limit=20`,
    );
  });
});

describe("publishArtifactHtml", () => {
  it("posts the content and returns url / slug / version", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, {
        url: "https://server.test/code/artifact/abc",
        slug: "abc",
        version: 2,
      }),
    );

    const result = await publishArtifactHtml({
      html: "<h1>hi</h1>",
      title: "index.html",
      url: "https://server.test/code/artifact/abc",
      baseVersion: 1,
    });

    expect(lastCall()[0]).toBe(`${SERVER_URL}/api/frame/deploy/direct`);
    expect(lastBody()).toEqual({
      content: "<h1>hi</h1>",
      favicon: "📄",
      title: "index.html",
      url: "https://server.test/code/artifact/abc",
      baseVersion: 1,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        url: "https://server.test/code/artifact/abc",
        slug: "abc",
        version: 2,
      },
    });
  });

  it("maps 409 to conflict so the preview can offer 强制覆盖", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { message: "a newer version exists" }),
    );

    const result = await publishArtifactHtml({ html: "<h1/>", baseVersion: 1 });

    expect(result).toEqual({
      ok: false,
      error: "a newer version exists",
      conflict: true,
    });
  });

  it("sends force when retrying an overwrite", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { url: "u", slug: "s", version: 3 }),
    );

    await publishArtifactHtml({ html: "<h1/>", baseVersion: 1, force: true });

    expect(lastBody()).toMatchObject({ force: true, baseVersion: 1 });
  });

  it("rejects a success reply without url/slug", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { version: 1 }));

    const result = await publishArtifactHtml({ html: "<h1/>" });

    expect(result.ok).toBe(false);
  });
});
