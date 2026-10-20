import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/services/authService.js", () => ({
  authService: {
    getServerUrl: vi.fn(() => "https://server.test"),
    getSSOToken: vi.fn(() => "token"),
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

import {
  pageCommentEventToXml,
  parsePageCommentEventXml,
} from "../../src/utils/pageCommentEventXml.js";

describe("pageCommentEventXml", () => {
  it("round-trips the full event", () => {
    const xml = pageCommentEventToXml({
      url: "https://server.test/code/artifact/abc",
      slug: "abc",
      count: 2,
      threadIds: ["t1", "t2"],
    });
    expect(xml.startsWith("<page-comment-event>")).toBe(true);
    expect(xml).toContain(
      "<artifact>https://server.test/code/artifact/abc</artifact>",
    );
    expect(xml).toContain("<slug>abc</slug>");
    expect(xml).toContain("<count>2</count>");
    expect(xml).toContain("<threads>t1,t2</threads>");
    expect(parsePageCommentEventXml(xml)).toEqual({
      url: "https://server.test/code/artifact/abc",
      slug: "abc",
      count: 2,
      threadIds: ["t1", "t2"],
    });
  });

  it("omits count and threads when they are unknown", () => {
    const xml = pageCommentEventToXml({
      url: "https://server.test/code/artifact/abc",
      slug: "abc",
    });
    expect(xml).not.toContain("<count>");
    expect(xml).not.toContain("<threads>");
    expect(parsePageCommentEventXml(xml)).toEqual({
      url: "https://server.test/code/artifact/abc",
      slug: "abc",
    });
  });

  it("carries no comment text and tells the model to read first", () => {
    const xml = pageCommentEventToXml({
      url: "https://server.test/code/artifact/abc",
      slug: "abc",
      count: 1,
      threadIds: ["t1"],
    });
    expect(xml).toContain('action "comments"');
    expect(xml).toContain("This event carries no comment text.");
  });

  it("escapes XML-significant characters", () => {
    const xml = pageCommentEventToXml({
      url: "https://server.test/code/artifact/a&b",
      slug: "a&b",
      threadIds: ["<t1>"],
    });
    expect(xml).toContain("<slug>a&amp;b</slug>");
    expect(xml).toContain("<threads>&lt;t1&gt;</threads>");
    expect(parsePageCommentEventXml(xml)?.slug).toBe("a&b");
  });

  it("returns null for anything that is not a page-comment event", () => {
    expect(
      parsePageCommentEventXml(
        "<task-notification><task-id>t</task-id></task-notification>",
      ),
    ).toBeNull();
    expect(
      parsePageCommentEventXml(
        "<page-comment-event>garbage</page-comment-event>",
      ),
    ).toBeNull();
  });
});
