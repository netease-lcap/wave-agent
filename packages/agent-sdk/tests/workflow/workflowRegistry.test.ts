import { describe, it, expect, beforeEach, vi } from "vitest";

const homeDir = vi.hoisted(() => ({ value: "/fake/home" }));

const fakeFs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  dirs: new Map<string, string[]>(),
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => homeDir.value };
});

vi.mock("node:fs", () => ({
  existsSync: (filePath: string) => fakeFs.files.has(filePath),
  readFileSync: (filePath: string) => {
    const content = fakeFs.files.get(filePath);
    if (content === undefined) {
      throw new Error(`ENOENT: ${filePath}`);
    }
    return content;
  },
  readdirSync: (dir: string) =>
    (fakeFs.dirs.get(dir) ?? []).map((name) => ({
      name,
      isFile: () => true,
    })),
}));

import {
  WorkflowRegistry,
  parseWorkflowName,
  sanitizeWorkflowName,
} from "../../src/workflow/workflowRegistry.js";

const SCRIPT = `export const meta = { name: "saved", description: "A saved workflow" };\nreturn 1;`;
const WORKDIR = "/fake/project";

/** Put a script into one library scope of the fake filesystem. */
function addLibraryScript(
  scope: "project" | "user",
  name: string,
  script = SCRIPT,
): string {
  const dir =
    scope === "project"
      ? `${WORKDIR}/.wave/workflows`
      : `${homeDir.value}/.wave/workflows`;
  const file = `${dir}/${name}.js`;
  fakeFs.files.set(file, script);
  fakeFs.dirs.set(dir, [...(fakeFs.dirs.get(dir) ?? []), `${name}.js`]);
  return file;
}

beforeEach(() => {
  fakeFs.files.clear();
  fakeFs.dirs.clear();
});

describe("sanitizeWorkflowName", () => {
  it("lowercases and collapses runs of non-alphanumerics", () => {
    expect(sanitizeWorkflowName("My Script!!")).toBe("my-script");
    expect(sanitizeWorkflowName("code-review")).toBe("code-review");
    expect(sanitizeWorkflowName("  a  b  ")).toBe("a-b");
  });

  it("falls back to `workflow` when nothing survives", () => {
    expect(sanitizeWorkflowName("!!!")).toBe("workflow");
    expect(sanitizeWorkflowName("")).toBe("workflow");
  });
});

describe("parseWorkflowName", () => {
  it("treats a name with `:` as a plugin namespace", () => {
    expect(parseWorkflowName("my-plugin:scan")).toEqual({
      pluginName: "my-plugin",
      bareName: "scan",
    });
  });

  it("treats a bare name as a library lookup", () => {
    expect(parseWorkflowName("code-review")).toEqual({
      bareName: "code-review",
    });
  });
});

describe("WorkflowRegistry", () => {
  it("resolves a bare name from the project library first", () => {
    const projectFile = addLibraryScript("project", "code-review");
    addLibraryScript("user", "code-review");
    const registry = new WorkflowRegistry(WORKDIR);

    const resolved = registry.resolve("code-review");
    expect(resolved?.source).toBe("project");
    expect(resolved?.path).toBe(projectFile);
    expect(resolved?.description).toBe("A saved workflow");
  });

  it("falls back to the user library", () => {
    const userFile = addLibraryScript("user", "shared-check");
    const registry = new WorkflowRegistry(WORKDIR);

    const resolved = registry.resolve("shared-check");
    expect(resolved?.source).toBe("user");
    expect(resolved?.path).toBe(userFile);
  });

  it("returns undefined for an unknown name", () => {
    expect(new WorkflowRegistry(WORKDIR).resolve("nope")).toBeUndefined();
  });

  it("does not resolve a bare name through the plugin namespace", () => {
    addLibraryScript("project", "my-plugin-scan");
    expect(
      new WorkflowRegistry(WORKDIR).resolve("my-plugin:scan"),
    ).toBeUndefined();
  });

  it("skips a library file whose meta is invalid", () => {
    addLibraryScript("project", "broken", "export const meta = {};\nreturn 1;");
    expect(new WorkflowRegistry(WORKDIR).resolve("broken")).toBeUndefined();
  });

  it("registers plugin workflows under `<plugin>:<name>` and drops them on unregister", () => {
    const registry = new WorkflowRegistry(WORKDIR);
    registry.registerPluginWorkflows("my-plugin", [
      {
        name: "scan",
        description: "Scan a repo",
        path: "/plugins/my-plugin/1.0.0/workflows/scan.js",
        meta: { name: "scan", description: "Scan a repo" },
      },
    ]);

    expect(registry.resolve("my-plugin:scan")?.source).toBe("plugin");
    expect(registry.resolve("my-plugin:scan")?.description).toBe("Scan a repo");

    registry.unregisterPluginWorkflows("my-plugin");
    expect(registry.resolve("my-plugin:scan")).toBeUndefined();
  });

  it("lists plugin and library names without duplicating a project/user pair", () => {
    addLibraryScript("project", "code-review");
    addLibraryScript("user", "code-review");
    addLibraryScript("user", "user-only");
    const registry = new WorkflowRegistry(WORKDIR);
    registry.registerPluginWorkflows("p", [
      {
        name: "scan",
        description: "Scan",
        path: "/p/scan.js",
        meta: { name: "scan", description: "Scan" },
      },
    ]);

    expect(registry.availableNames()).toEqual([
      "code-review",
      "p:scan",
      "user-only",
    ]);
  });
});
