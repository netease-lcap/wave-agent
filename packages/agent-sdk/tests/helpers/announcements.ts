import type { Message } from "../../src/types/index.js";

/**
 * Drop the host's own per-turn announcements from a message list.
 *
 * The skill list, the on-demand tool catalog and MCP usage notes are user-role
 * meta messages appended before a request, so a test pinning the *conversation*
 * contract ("which hook output ended up where") has to look past them —
 * otherwise every new announcement rewrites its counts and indexes. What the
 * model actually receives is asserted where that is the subject
 * (`tests/agent/agent.toolLoop.test.ts`).
 */
export function withoutAnnouncements(messages: Message[]): Message[] {
  return messages.filter(
    (message) =>
      !(
        message.isMeta === true &&
        message.blocks.some(
          (block) =>
            block.type === "text" &&
            /<!-- (skill-listing|exec-catalog|mcp-instructions) /.test(
              block.content,
            ),
        )
      ),
  );
}
