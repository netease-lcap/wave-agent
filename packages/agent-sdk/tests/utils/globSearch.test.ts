import { describe, it, expect } from "vitest";
import {
  buildGlobArgs,
  extractGlobBaseDirectory,
  normalizeGlobPattern,
} from "@/utils/globSearch.js";
import { VCS_DIRECTORIES } from "@/utils/vcsDirectories.js";

describe("extractGlobBaseDirectory", () => {
  it("keeps a pattern with no directory as a plain glob", () => {
    expect(extractGlobBaseDirectory("**/*.ts")).toEqual({
      baseDir: "",
      relativePattern: "**/*.ts",
    });
    expect(extractGlobBaseDirectory("*.ts")).toEqual({
      baseDir: "",
      relativePattern: "*.ts",
    });
  });

  it("cuts at the last separator before the first special character", () => {
    expect(extractGlobBaseDirectory("src/**/*.ts")).toEqual({
      baseDir: "src",
      relativePattern: "**/*.ts",
    });
    // Only the static part is the root; `deep` holds a `*`, so it stays in
    // the pattern.
    expect(extractGlobBaseDirectory("src/deep/*/x?.ts")).toEqual({
      baseDir: "src/deep",
      relativePattern: "*/x?.ts",
    });
  });

  it("treats an absolute pattern as one more separator cut", () => {
    expect(extractGlobBaseDirectory("/work/project/**/*.ts")).toEqual({
      baseDir: "/work/project",
      relativePattern: "**/*.ts",
    });
  });

  it("keeps the root directory when the pattern starts at it", () => {
    expect(extractGlobBaseDirectory("/*.ts")).toEqual({
      baseDir: "/",
      relativePattern: "*.ts",
    });
  });

  it("degrades a literal path to directory plus file name", () => {
    const { baseDir, relativePattern } =
      extractGlobBaseDirectory("src/index.ts");
    expect(baseDir).toBe("src");
    expect(relativePattern).toBe("index.ts");
  });

  it("keeps a Windows-style separator in the pattern for the caller to normalize", () => {
    expect(extractGlobBaseDirectory("src\\**\\*.ts")).toEqual({
      baseDir: "src",
      relativePattern: "**\\*.ts",
    });
  });

  // `C:` alone means "the current directory on drive C", so a drive root needs
  // the separator back before it can be used as a walk root.
  it.skipIf(process.platform !== "win32")(
    "restores the separator of a Windows drive root",
    () => {
      expect(extractGlobBaseDirectory("C:/*.ts")).toEqual({
        baseDir: "C:\\",
        relativePattern: "*.ts",
      });
    },
  );
});

describe("normalizeGlobPattern", () => {
  it("rewrites backslashes so ripgrep does not read them as escapes", () => {
    expect(normalizeGlobPattern("src\\**\\*.ts")).toBe("src/**/*.ts");
    expect(normalizeGlobPattern("src/deep/*.ts")).toBe("src/deep/*.ts");
  });
});

describe("buildGlobArgs", () => {
  it("asks ripgrep for files with the aligned defaults", () => {
    expect(buildGlobArgs("src/**/*.ts")).toEqual([
      "--files",
      "--glob",
      "src/**/*.ts",
      "--sort=modified",
      "--no-ignore",
      "--hidden",
      ...VCS_DIRECTORIES.flatMap((dir) => ["--glob", `!${dir}`]),
    ]);
  });

  it("normalizes the pattern on the way in", () => {
    const args = buildGlobArgs("src\\**\\*.ts");
    expect(args[args.indexOf("--glob") + 1]).toBe("src/**/*.ts");
  });
});
