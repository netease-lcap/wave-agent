import { describe, it, expect, beforeAll, vi, afterAll } from "vitest";
import { highlightToAnsi } from "../../src/utils/highlightUtils.js";
import chalk from "chalk";

describe("highlightToAnsi", () => {
  beforeAll(() => {
    process.env.FORCE_COLOR = "1";
    chalk.level = 1;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should highlight typescript code", () => {
    const code = "const x = 1;";
    const highlighted = highlightToAnsi(code, "ts");

    // 'const' should be blue (hljs-keyword)
    expect(highlighted).toContain(chalk.blue("const"));
    // '1' should be magenta (hljs-number)
    expect(highlighted).toContain(chalk.magenta("1"));
  });

  it("should highlight javascript code automatically", () => {
    const code = 'function hello() { console.log("world"); }';
    const highlighted = highlightToAnsi(code);

    // 'function' should be blue (hljs-keyword)
    expect(highlighted).toContain(chalk.blue("function"));
    // '"world"' should be green (hljs-string)
    expect(highlighted).toContain(chalk.green('"world"'));
  }, 2000); // Increase timeout for auto-detection if needed, but it should be faster now with fewer tests running it

  it("should handle unknown languages gracefully", () => {
    const code = "some random text";
    const highlighted = highlightToAnsi(code, "nonexistent");
    expect(highlighted).toBe(code);
  });

  it("should handle errors gracefully", () => {
    // This might be hard to trigger with highlight.js but we can try
    const highlighted = highlightToAnsi(null as unknown as string, "ts");
    expect(highlighted).toBe("");
  });
});
