import {
  DIR_EXISTS_GUIDANCE,
  MEMORY_AND_OTHER_PERSISTENCE_SECTION,
  TYPES_SECTION,
  TRUSTING_RECALL_SECTION,
  WHAT_NOT_TO_SAVE_SECTION,
  WHEN_TO_ACCESS_SECTION,
  buildHowToSaveSection,
} from "./memoryTypes.js";

/**
 * Build the main agent's auto-memory prompt. The section order mirrors Claude
 * Code's `buildMemoryLines()` (individual-only variant). The index content of
 * `MEMORY.md` is appended separately by the system prompt builder, so this
 * function only produces the behavioral instructions.
 *
 * Every section except the directory line is shared with the extraction fork
 * prompt (`autoMemoryExtraction.ts`) — see `memoryTypes.ts` for why.
 */
export function buildAutoMemoryPrompt(memoryDir: string): string {
  return [
    "# auto memory",
    "",
    `You have a persistent, file-based memory system at \`${memoryDir}\`. ${DIR_EXISTS_GUIDANCE}`,
    "",
    "You should build up this memory system over time so that future conversations can have a complete picture of who the user is, how they'd like to collaborate with you, what behaviors to avoid or repeat, and the context behind the work the user gives you.",
    "",
    "If the user explicitly asks you to remember something, save it immediately as whichever type fits best. If they ask you to forget something, find and remove the relevant entry.",
    "",
    ...TYPES_SECTION,
    ...WHAT_NOT_TO_SAVE_SECTION,
    "",
    ...buildHowToSaveSection(),
    "",
    ...WHEN_TO_ACCESS_SECTION,
    "",
    ...TRUSTING_RECALL_SECTION,
    "",
    ...MEMORY_AND_OTHER_PERSISTENCE_SECTION,
  ].join("\n");
}
