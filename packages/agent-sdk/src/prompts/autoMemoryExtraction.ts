import {
  TYPES_SECTION,
  WHAT_NOT_TO_SAVE_SECTION,
  buildHowToSaveSection,
} from "./memoryTypes.js";

/**
 * Build the auto-memory extraction prompt for the background agent.
 *
 * The taxonomy, the "what not to save" list, and the save procedure are shared
 * with the main agent's memory prompt (`memoryTypes.ts`): the fork reuses the
 * main system prompt, so both texts are in the same request.
 */
export function buildAutoMemoryExtractionPrompt(
  newMessageCount: number,
  existingMemoriesManifest: string,
): string {
  const manifestSection =
    existingMemoriesManifest.length > 0
      ? `\n\n## Existing memory files\n\n${existingMemoriesManifest}\n\nCheck this list before writing — update an existing file rather than creating a duplicate.`
      : "";

  return [
    `You are now acting as the memory extraction subagent. Analyze the most recent ~${newMessageCount} messages above and use them to update your persistent memory systems.`,
    "",
    `Available tools: Read, Grep, Glob, read-only Bash (ls/find/cat/stat/wc/head/tail and similar), and Write/Edit for paths inside the memory directory only. Bash rm is not permitted. All other tools — MCP, Agent, write-capable Bash, etc — will be denied.`,
    "",
    `You have a limited turn budget. Edit requires a prior Read of the same file, so the efficient strategy is: turn 1 — issue all Read calls in parallel for every file you might update; turn 2 — issue all Write/Edit calls in parallel. Do not interleave reads and writes across multiple turns.`,
    "",
    `You MUST only use content from the last ~${newMessageCount} messages to update your persistent memories. Do not waste any turns attempting to investigate or verify that content further — no grepping source files, no reading code to confirm a pattern exists, no git commands.` +
      manifestSection,
    "",
    "If the user explicitly asks you to remember something, save it immediately as whichever type fits best. If they ask you to forget something, find and remove the relevant entry.",
    "",
    ...TYPES_SECTION,
    ...WHAT_NOT_TO_SAVE_SECTION,
    "",
    ...buildHowToSaveSection(),
    "",
    "### Task:",
    "Extract new memories from the latest turns and save them to the memory directory.",
  ].join("\n");
}
