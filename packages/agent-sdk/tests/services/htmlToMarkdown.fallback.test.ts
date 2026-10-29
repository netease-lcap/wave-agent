import { describe, it, expect, vi } from "vitest";

// Injected conversion failure: the shared service always throws, which is the
// branch that has to degrade instead of failing the read.
vi.mock("turndown", () => ({
  default: class {
    remove() {}
    turndown(): string {
      throw new Error("malformed markup");
    }
  },
}));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { logger } from "../../src/utils/globalLogger.js";
import { htmlToMarkdown } from "../../src/services/artifactContent.js";

describe("htmlToMarkdown - conversion failure", () => {
  it("should fall back to the raw HTML and log instead of throwing", () => {
    const html = "<html><body><p>Body</p></body></html>";

    expect(htmlToMarkdown(html)).toBe(html);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Turndown failed, falling back to raw HTML"),
    );
  });
});
