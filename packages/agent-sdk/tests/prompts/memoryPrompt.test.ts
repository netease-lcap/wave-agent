import { describe, it, expect } from "vitest";
import { buildAutoMemoryPrompt } from "../../src/prompts/autoMemory.js";
import { buildAutoMemoryExtractionPrompt } from "../../src/prompts/autoMemoryExtraction.js";
import {
  MEMORY_TYPES,
  TYPES_SECTION,
  WHAT_NOT_TO_SAVE_SECTION,
  buildHowToSaveSection,
} from "../../src/prompts/memoryTypes.js";
import {
  MAX_MEMORY_ENTRYPOINT_BYTES,
  MAX_MEMORY_ENTRYPOINT_LINES,
} from "../../src/constants/memory.js";

const MEMORY_DIR = "/home/user/.wave/projects/abc/memory";

/**
 * The main prompt and the extraction fork prompt end up in the *same* request
 * (the fork reuses the main system prompt), so their overlapping sections must
 * be byte-identical. Sharing one source of truth is what makes that true; these
 * tests pin the sharing so a future edit cannot re-fork the copy silently.
 */
describe("auto-memory prompt", () => {
  const prompt = buildAutoMemoryPrompt(MEMORY_DIR);
  const forkPrompt = buildAutoMemoryExtractionPrompt(3, "");

  describe("main prompt sections", () => {
    it("names the memory directory and states it already exists", () => {
      expect(prompt).toContain(`\`${MEMORY_DIR}\``);
      expect(prompt).toContain("This directory already exists");
      expect(prompt).toContain("do not run mkdir or check for its existence");
    });

    it("defines all four memory types with save triggers and usage", () => {
      for (const type of MEMORY_TYPES) {
        expect(prompt).toContain(`<name>${type}</name>`);
      }
      expect(prompt).toContain("<when_to_save>");
      expect(prompt).toContain("<how_to_use>");
      expect(prompt).toContain("<examples>");
    });

    it("lists what must not be saved and applies the gate to explicit requests", () => {
      expect(prompt).toContain("## What NOT to save in memory");
      expect(prompt).toContain("Code patterns, conventions, architecture");
      expect(prompt).toContain("Debugging solutions or fix recipes");
      expect(prompt).toContain(
        "These exclusions apply even when the user explicitly asks you to save.",
      );
    });

    it("describes the two-step save with matching entrypoint limits", () => {
      expect(prompt).toContain("Saving a memory is a two-step process:");
      expect(prompt).toContain("**Step 1**");
      expect(prompt).toContain("**Step 2**");
      expect(prompt).toContain("It has no frontmatter.");
      expect(prompt).toContain(
        `lines after ${MAX_MEMORY_ENTRYPOINT_LINES} or bytes past ${MAX_MEMORY_ENTRYPOINT_BYTES}`,
      );
    });

    it("covers when to access memory including the ignore semantics", () => {
      expect(prompt).toContain("## When to access memories");
      expect(prompt).toContain(
        "You MUST access memory when the user explicitly asks you to check, recall, or remember.",
      );
      expect(prompt).toContain("proceed as if MEMORY.md were empty");
      expect(prompt).toContain("Do not apply remembered facts, cite");
    });

    it("tells the model to verify recalled claims before recommending", () => {
      expect(prompt).toContain("## Before recommending from memory");
      expect(prompt).toContain("check the file exists");
      expect(prompt).toContain("grep for it");
      expect(prompt).toContain(
        '"The memory says X exists" is not the same as "X exists now."',
      );
    });

    it("divides labor between memory, plans, and tasks", () => {
      expect(prompt).toContain("## Memory and other forms of persistence");
      expect(prompt).toContain(
        "When to use or update a plan instead of memory",
      );
      expect(prompt).toContain("When to use or update tasks instead of memory");
    });

    it("does not re-introduce the removed 'What to save' section", () => {
      // The old hand-written section told the model to save architecture and
      // file paths — exactly what the "what NOT to save" list forbids. Both
      // texts ship in the same request, so its return would restore the
      // contradiction this refactor removed.
      expect(prompt).not.toContain("## What to save");
      expect(prompt).not.toContain("Key architectural decisions");
      expect(prompt).not.toContain("Stable patterns and conventions");
    });
  });

  describe("shared sections", () => {
    it("renders the taxonomy identically in both prompts", () => {
      const types = TYPES_SECTION.join("\n");
      expect(prompt).toContain(types);
      expect(forkPrompt).toContain(types);
    });

    it("renders the exclusions identically in both prompts", () => {
      const exclusions = WHAT_NOT_TO_SAVE_SECTION.join("\n");
      expect(prompt).toContain(exclusions);
      expect(forkPrompt).toContain(exclusions);
    });

    it("renders the save procedure and frontmatter identically in both prompts", () => {
      const howToSave = buildHowToSaveSection().join("\n");
      expect(prompt).toContain(howToSave);
      expect(forkPrompt).toContain(howToSave);
    });

    it("keeps one frontmatter format across both prompts", () => {
      const frontmatterCount = (text: string) =>
        text.split("name: {{memory name}}").length - 1;
      expect(frontmatterCount(prompt)).toBe(1);
      expect(frontmatterCount(forkPrompt)).toBe(1);
    });
  });

  describe("extraction fork prompt", () => {
    it("includes the existing memory files manifest when provided", () => {
      const manifest =
        "- [project] build.md (2026-01-02T03:04:05.000Z): build cmd";
      const withManifest = buildAutoMemoryExtractionPrompt(3, manifest);
      expect(withManifest).toContain("## Existing memory files");
      expect(withManifest).toContain(manifest);
    });

    it("omits the manifest section when there are no memory files", () => {
      expect(forkPrompt).not.toContain("## Existing memory files");
    });
  });
});
