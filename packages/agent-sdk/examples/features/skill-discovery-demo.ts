#!/usr/bin/env tsx
/**
 * Real-model probe: the skill listing (a meta message, not the tool
 * description) and subtree skill discovery (a `Read`/`Write`/`Edit` in a
 * subdirectory makes that subtree's skills callable).
 *
 * Both are invisible to a mocked unit test in exactly the way that matters:
 * the listing has to reach the model *in the same request* that can call the
 * skills, and a skill discovered mid-turn has to become callable without a
 * restart. So this drives a real `Agent` against the real gateway and asserts
 * on `agent.messages`.
 *
 * Prerequisites: `~/.wave/auth.json` (real login) and a model your account can
 * call. Run from `packages/agent-sdk`:
 *
 *   HOME=/tmp/wave-probe-home pnpm exec tsx examples/features/skill-discovery-demo.ts
 *
 * (`HOME` pointed at a throwaway directory keeps your own `~/.wave/settings.json`,
 * plugins and session history out of the run; copy `auth.json` into it.)
 */
import { Agent } from "../../src/agent.js";
import { SKILL_LISTING_MARKER_PREFIX } from "../../src/utils/skillListing.js";
import { SKILL_TOOL_NAME } from "../../src/constants/tools.js";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Message } from "../../src/types/index.js";

const failures: string[] = [];

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/** The text of a message, flattened across blocks. */
function textOf(message: Message): string {
  return message.blocks
    .map((block) => (block.type === "text" ? block.content : ""))
    .join("\n");
}

/** Every announced skill list in the conversation, in order. */
function listings(messages: Message[]): string[] {
  return messages
    .filter(
      (message) =>
        message.role === "user" &&
        message.isMeta &&
        textOf(message).includes(SKILL_LISTING_MARKER_PREFIX),
    )
    .map(textOf);
}

function namesIn(listing: string): string[] {
  return [...listing.matchAll(/^- ([a-z0-9-]+):/gm)].map((match) => match[1]);
}

async function writeSkill(
  dir: string,
  name: string,
  description: string,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nSay "OK from ${name}. "\n`,
  );
}

async function main(): Promise<void> {
  const workdir = await mkdtemp(join(tmpdir(), "skill-discovery-"));

  // The tree is laid down *before* the session starts, which is how a real
  // project looks: a skill written while the agent is already running arrives
  // through the file watcher, and racing the first turn against that would test
  // the watcher's latency rather than discovery.
  //
  // One skill at the top, one three levels down: a startup scan that walked
  // subdirectories would list the nested one in the very first announcement.
  await writeSkill(
    join(workdir, ".wave", "skills", "top-skill"),
    "top-skill",
    "Use when asked about the top level",
  );
  await writeSkill(
    join(workdir, "packages", "foo", ".wave", "skills", "deep-skill"),
    "deep-skill",
    "Use when asked about a nested subtree",
  );
  await mkdir(join(workdir, "packages", "foo", "src"), { recursive: true });
  await writeFile(
    join(workdir, "packages", "foo", "src", "a.ts"),
    "export const answer = 42;\n",
  );

  const agent = await Agent.create({
    workdir,
    permissionMode: "acceptEdits",
    callbacks: {
      onToolBlockUpdated: ({ name, stage, success }) => {
        if (stage === "end") {
          console.log(`   🛠️  ${name} → ${success ? "ok" : "failed"}`);
        }
      },
      onNoticeAdded: ({ level, content }) => {
        if (level === "error") console.log(`   ⚠️  ${content}`);
      },
    },
  });

  try {
    console.log("\n▶ Turn 1: read a file three levels down");
    await agent.sendMessage(
      "Read packages/foo/src/a.ts and tell me the value of `answer`.",
    );

    // The turn loop announces once per iteration, so reaching into a subtree
    // produces a second list within the same turn.
    const afterFirst = listings(agent.messages);
    const firstList = afterFirst[0] ?? "";
    const latestList = afterFirst.at(-1) ?? "";
    check(
      "a skill list was announced as a meta message",
      afterFirst.length > 0,
    );
    check(
      "the first list has the top-level skill",
      namesIn(firstList).includes("top-skill"),
      namesIn(firstList).join(", "),
    );
    check(
      "the first list does not have the untouched subtree's skill",
      !namesIn(firstList).includes("deep-skill"),
    );
    check(
      "the file was actually read",
      agent.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.blocks.some(
            (block) =>
              block.type === "tool" &&
              block.name === "Read" &&
              block.success === true,
          ),
      ),
    );
    check(
      "the read added the subtree's skill to a later list in the same turn",
      afterFirst.length > 1 && namesIn(latestList).includes("deep-skill"),
      namesIn(latestList).join(", "),
    );

    console.log(
      "\n▶ Turn 2: the subtree skill should still be listed and callable",
    );
    await agent.sendMessage(
      `Invoke the "${SKILL_TOOL_NAME}" tool with skill_name "deep-skill". Do nothing else.`,
    );

    const afterSecond = listings(agent.messages);
    check(
      "an unchanged skill set is not announced again",
      afterSecond.length === afterFirst.length,
      `${afterFirst.length} → ${afterSecond.length} lists`,
    );
    check(
      "the earlier lists were left untouched (append-only history)",
      afterSecond[0] === firstList,
    );
    check(
      "the nested skill was invocable",
      agent.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.blocks.some(
            (block) =>
              block.type === "tool" &&
              block.name === SKILL_TOOL_NAME &&
              block.success === true,
          ),
      ),
    );
    check(
      "no list leaked into a non-meta message",
      agent.messages
        .filter((message) => !message.isMeta)
        .every(
          (message) => !textOf(message).includes(SKILL_LISTING_MARKER_PREFIX),
        ),
    );

    console.log(`\n📋 First list:\n${firstList}`);
    console.log(`\n📋 Latest list:\n${latestList}\n`);
  } finally {
    await agent.destroy();
    await rm(workdir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.log(`${failures.length} check(s) failed:`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
  console.log("All checks passed.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
  });
