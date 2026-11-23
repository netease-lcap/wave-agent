import { describe, it, expect, vi, beforeEach } from "vitest";
import { join, resolve } from "path";
import { stat } from "fs/promises";
import { sendUserFileTool } from "../../src/tools/sendUserFileTool.js";
import type { ToolContext } from "../../src/tools/types.js";
import {
  classifyDeliverablePath,
  isBlockedExecutablePath,
} from "../../src/constants/deliverableFiles.js";

vi.mock("fs/promises", () => ({ stat: vi.fn() }));

const WORKDIR = resolve("/fake/project");

type StatResult = Awaited<ReturnType<typeof stat>>;

function asFile(): StatResult {
  return { isFile: () => true } as unknown as StatResult;
}

function asDirectory(): StatResult {
  return { isFile: () => false } as unknown as StatResult;
}

/** Every path resolves to a regular file unless the test says otherwise. */
function mockDisk(
  overrides: Record<string, "missing" | "directory"> = {},
): void {
  vi.mocked(stat).mockImplementation(async (path) => {
    const key = String(path);
    const override = overrides[key];
    if (override === "missing") throw new Error("ENOENT");
    if (override === "directory") return asDirectory();
    return asFile();
  });
}

describe("SendUserFile Tool", () => {
  const context = { workdir: WORKDIR } as ToolContext;

  beforeEach(() => {
    vi.mocked(stat).mockReset();
    mockDisk();
  });

  it("has the tool configuration the hosts look up by name", () => {
    expect(sendUserFileTool.name).toBe("SendUserFile");
    expect(sendUserFileTool.config.function.name).toBe("SendUserFile");
    expect(typeof sendUserFileTool.prompt?.()).toBe("string");
    // Flat declaration: delivery is common enough that hiding it behind a
    // deferred load would cost a search round-trip every time.
    expect(sendUserFileTool.defer).toBeUndefined();
  });

  it("delivers an absolute path with the structured metadata the webview renders", async () => {
    const file = join(WORKDIR, "report.md");

    const result = await sendUserFileTool.execute(
      { files: [file], caption: "the finished report" },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.metadata).toEqual({
      files: [{ path: file, name: "report.md", kind: "text" }],
      caption: "the finished report",
    });
    expect(result.shortResult).toBe("report.md");
  });

  it("resolves relative paths against the session workdir", async () => {
    const expected = join(WORKDIR, "out", "chart.png");

    const result = await sendUserFileTool.execute(
      { files: ["out/chart.png"] },
      context,
    );

    expect(result.success).toBe(true);
    const metadata = result.metadata as {
      files: Array<{ path: string; kind: string }>;
    };
    expect(metadata.files[0].path).toBe(expected);
    expect(metadata.files[0].kind).toBe("image");
  });

  it("accepts a bare string and de-duplicates repeated paths", async () => {
    const file = join(WORKDIR, "a.txt");

    expect(
      (await sendUserFileTool.execute({ files: file }, context)).success,
    ).toBe(true);

    const duplicated = await sendUserFileTool.execute(
      { files: [file, file] },
      context,
    );
    const metadata = duplicated.metadata as { files: unknown[] };
    expect(metadata.files).toHaveLength(1);
  });

  it("fails the whole call when any path is missing", async () => {
    const good = join(WORKDIR, "good.md");
    const missing = join(WORKDIR, "nope.md");
    mockDisk({ [missing]: "missing" });

    const result = await sendUserFileTool.execute(
      { files: [good, "nope.md"] },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("nope.md");
    expect(result.metadata).toBeUndefined();
  });

  it("rejects directories", async () => {
    const dir = join(WORKDIR, "somedir");
    mockDisk({ [dir]: "directory" });

    const result = await sendUserFileTool.execute({ files: [dir] }, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain("not a file");
  });

  it("rejects an empty files list and a missing parameter", async () => {
    expect(
      (await sendUserFileTool.execute({ files: [] }, context)).success,
    ).toBe(false);
    expect((await sendUserFileTool.execute({}, context)).success).toBe(false);
  });

  it("delivers an executable like any other file and leaves the refusal to the host", async () => {
    const file = join(WORKDIR, "setup.exe");

    const result = await sendUserFileTool.execute({ files: [file] }, context);

    expect(result.success).toBe(true);
    const metadata = result.metadata as {
      files: Array<{ kind: string }>;
    };
    // No separate "blocked" kind: the UI classifies it as a plain file and the
    // host's opener is what refuses to launch it.
    expect(metadata.files[0].kind).toBe("other");
    // The model is still told it will not open, so it does not retry.
    expect(result.content).toContain("never opened");
  });

  it("formats the collapsed summary from the file names", () => {
    const one = sendUserFileTool.formatCompactParams?.(
      { files: [join(WORKDIR, "a.md")] },
      context,
    );
    const several = sendUserFileTool.formatCompactParams?.(
      { files: [join(WORKDIR, "a.md"), join(WORKDIR, "b.png")] },
      context,
    );
    expect(one).toBe("a.md");
    expect(several).toBe("a.md +1");
  });
});

describe("classifyDeliverablePath", () => {
  it("routes text, image and the rest apart", () => {
    expect(classifyDeliverablePath(join(WORKDIR, "report.md"))).toBe("text");
    expect(classifyDeliverablePath(join(WORKDIR, "Dockerfile"))).toBe("text");
    expect(classifyDeliverablePath(join(WORKDIR, ".gitignore"))).toBe("text");
    expect(classifyDeliverablePath(join(WORKDIR, "shot.PNG"))).toBe("image");
    expect(classifyDeliverablePath(join(WORKDIR, "report.pdf"))).toBe("other");
    expect(classifyDeliverablePath(join(WORKDIR, "bundle.zip"))).toBe("other");
    // Executables are "other": only the host's opener knows to refuse them.
    expect(classifyDeliverablePath(join(WORKDIR, "setup.exe"))).toBe("other");
    expect(classifyDeliverablePath(join(WORKDIR, "tool.AppImage"))).toBe(
      "other",
    );
  });

  it("keeps scripts in the text lane so they never reach the OS opener", () => {
    // Opening a script in the editor does not execute it; blocking it would only
    // turn "look at this script" into a refusal.
    expect(classifyDeliverablePath(join(WORKDIR, "deploy.sh"))).toBe("text");
    expect(classifyDeliverablePath(join(WORKDIR, "build.bat"))).toBe("text");
    expect(classifyDeliverablePath(join(WORKDIR, "task.ps1"))).toBe("text");
    expect(isBlockedExecutablePath(join(WORKDIR, "deploy.sh"))).toBe(false);
    expect(isBlockedExecutablePath(join(WORKDIR, "setup.exe"))).toBe(true);
  });
});
