/**
 * Session reference resolution: a complete sessionId, a unique id prefix, or a
 * session's name (its `customTitle`).
 *
 * The rules live in one pure module so that every subcommand answers the same
 * way — which is why they are pinned here, without a daemon: the order between
 * the three levels cannot be observed from any single command, and getting it
 * wrong is silent (a name would quietly mean "a different session's id
 * prefix"). The command-level consequences (ambiguity output, rename, default
 * names) are covered in ./commands.test.ts.
 */

import { test, expect } from "vitest";
import {
  SESSION_NAME_MAX_LENGTH,
  describeNotFound,
  isFullSessionId,
  matchByName,
  matchBySessionId,
  normalizeSessionName,
  pickDefaultSessionName,
  renderAmbiguousRef,
  renderCandidateTable,
  type SessionCandidate,
} from "../../src/daemon/sessionRef.js";

const ID_A = "c530abcd-1111-4111-8111-aaaaaaaaaaaa";
const ID_B = "c530ffff-2222-4222-8222-bbbbbbbbbbbb";
const ID_C = "7e112233-3333-4333-8333-cccccccccccc";

function candidate(
  sessionId: string,
  extra: Partial<SessionCandidate> = {},
): SessionCandidate {
  return {
    sessionId,
    workdir: "/repo/main",
    live: true,
    status: "idle",
    ...extra,
  };
}

// ── level 1 + 2: sessionId ─────────────────────────────────────

test("matchBySessionId: a complete id is an exact match, never a prefix match", () => {
  // A departed session's full id must not be read as a prefix of a live one:
  // `destroy` is idempotent on unknown ids, and a prefix match here would
  // destroy a *different* session.
  expect(
    matchBySessionId([candidate(ID_A)], ID_A.slice(0, -1) + "f"),
  ).toBeUndefined();
  expect(matchBySessionId([candidate(ID_A)], ID_A)).toEqual({
    kind: "found",
    sessionId: ID_A,
    matchedBy: "id",
  });
});

test("matchBySessionId: a unique prefix resolves, case-insensitively", () => {
  expect(matchBySessionId([candidate(ID_A), candidate(ID_C)], "c530")).toEqual({
    kind: "found",
    sessionId: ID_A,
    matchedBy: "id-prefix",
  });
  expect(
    matchBySessionId([candidate(ID_A)], ID_A.slice(0, 8).toUpperCase()),
  ).toMatchObject({ kind: "found", sessionId: ID_A, matchedBy: "id-prefix" });
});

test("matchBySessionId: a shared prefix is ambiguous and lists every match", () => {
  const match = matchBySessionId(
    [candidate(ID_A), candidate(ID_B), candidate(ID_C)],
    "c530",
  );
  expect(match).toMatchObject({ kind: "ambiguous", matchedBy: "id-prefix" });
  expect(
    (match as Extract<typeof match, { kind: "ambiguous" }>).candidates.map(
      (c) => c.sessionId,
    ),
  ).toEqual([ID_A, ID_B]);
});

test("matchBySessionId: only hex input of 4+ chars can be a prefix", () => {
  // Otherwise a session named `a` would be unaddressable, and `bob` would never
  // reach the name level (it is not hex, so it is not a prefix either).
  expect(matchBySessionId([candidate(ID_A)], "a")).toBeUndefined();
  expect(matchBySessionId([candidate(ID_A)], "c53")).toBeUndefined();
  expect(matchBySessionId([candidate(ID_A)], "bob")).toBeUndefined();
  expect(matchBySessionId([candidate(ID_A)], "zzzz")).toBeUndefined();
});

// ── level 3: name ──────────────────────────────────────────────

test("matchByName: an exact name resolves, and the same session listed twice is not an ambiguity", () => {
  // The live registry and the on-disk index both know a live session; that is
  // one candidate, not two.
  expect(
    matchByName(
      [
        candidate(ID_A, { name: "fix-1275" }),
        candidate(ID_A, { name: "fix-1275", live: false, status: undefined }),
      ],
      "fix-1275",
    ),
  ).toEqual({ kind: "found", sessionId: ID_A, matchedBy: "name" });
});

test("matchByName: two different sessions with the same name are ambiguous", () => {
  const match = matchByName(
    [
      candidate(ID_A, { name: "t1", workdir: "/repo/a" }),
      candidate(ID_B, { name: "t1", workdir: "/repo/b" }),
    ],
    "t1",
  );
  expect(match).toMatchObject({ kind: "ambiguous", matchedBy: "name" });
  expect(
    (match as Extract<typeof match, { kind: "ambiguous" }>).candidates,
  ).toHaveLength(2);
});

test("matchByName: matching is exact — no prefix, no case folding", () => {
  const candidates = [candidate(ID_A, { name: "fix-1275" })];
  expect(matchByName(candidates, "fix")).toBeUndefined();
  expect(matchByName(candidates, "Fix-1275")).toBeUndefined();
});

// ── the order between the levels ───────────────────────────────

test("a session named like an id prefix does not steal the prefix's meaning", () => {
  // The whole reason resolution runs id first: `c530` is a prefix of the live
  // session's id, so it must mean that session even though another session is
  // literally named `c530`. The named one stays reachable by its full id.
  const live = [candidate(ID_A)];
  const named = [candidate(ID_C, { name: "c530" })];
  expect(matchBySessionId(live, "c530")).toMatchObject({
    kind: "found",
    sessionId: ID_A,
    matchedBy: "id-prefix",
  });
  expect(matchByName(named, "c530")).toMatchObject({
    kind: "found",
    sessionId: ID_C,
    matchedBy: "name",
  });
});

test("isFullSessionId: only the uuid shape, so a title is never taken for an id", () => {
  expect(isFullSessionId(ID_A)).toBe(true);
  expect(isFullSessionId("c530")).toBe(false);
  expect(isFullSessionId("fix-1275")).toBe(false);
  expect(isFullSessionId(ID_A.slice(0, -1))).toBe(false);
});

// ── name validity ──────────────────────────────────────────────

test("normalizeSessionName: rejects only what cannot be addressed or printed", () => {
  expect(normalizeSessionName("")).toEqual({
    error: "Session name must not be empty or blank",
  });
  expect(normalizeSessionName("   ")).toMatchObject({
    error: expect.any(String),
  });
  expect(normalizeSessionName("a\nb")).toMatchObject({
    error: expect.stringContaining("single line"),
  });
  expect(normalizeSessionName("a".repeat(SESSION_NAME_MAX_LENGTH + 1))).toEqual(
    {
      error: `Session name must be at most ${SESSION_NAME_MAX_LENGTH} characters (got ${SESSION_NAME_MAX_LENGTH + 1})`,
    },
  );
});

test("normalizeSessionName: spaces are allowed, surrounding space is trimmed", () => {
  // Spaces are the shell's problem (quoting), not this command's: "修复 1275"
  // is a perfectly sayable name.
  expect(normalizeSessionName(" 修复 1275 ")).toEqual({ name: "修复 1275" });
  expect(normalizeSessionName("a".repeat(SESSION_NAME_MAX_LENGTH))).toEqual({
    name: "a".repeat(SESSION_NAME_MAX_LENGTH),
  });
});

// ── default names ──────────────────────────────────────────────

test("pickDefaultSessionName: <base>-<n>, skipping names already in use", () => {
  expect(pickDefaultSessionName("wave-agent", [])).toBe("wave-agent-1");
  // The default names must never collide: the user never sees the choice, so a
  // warning would arrive too late to act on.
  expect(
    pickDefaultSessionName("wave-agent", ["wave-agent-1", "wave-agent-2"]),
  ).toBe("wave-agent-3");
  // Gaps are reused rather than skipped past (2 is free even though 1 is not).
  expect(pickDefaultSessionName("wave-agent", ["wave-agent-1"])).toBe(
    "wave-agent-2",
  );
});

test("pickDefaultSessionName: caps the name at the length limit and survives an empty base", () => {
  const long = pickDefaultSessionName("x".repeat(200), []);
  expect(long.length).toBeLessThanOrEqual(SESSION_NAME_MAX_LENGTH);
  expect(long.endsWith("-1")).toBe(true);
  expect(pickDefaultSessionName("", [])).toBe("session-1");
  // A directory basename can carry a newline on POSIX; the name may not.
  expect(pickDefaultSessionName("a\nb", [])).toBe("a-b-1");
});

// ── rendering ──────────────────────────────────────────────────

test("renderCandidateTable: columns separate two same-named sessions", () => {
  const rows = renderCandidateTable(
    [
      candidate(ID_A, {
        name: "t1",
        workdir: "/repo/a",
        status: "generating",
      }),
      candidate(ID_B, {
        name: "t1",
        workdir: "/repo/b",
        live: false,
        status: undefined,
      }),
    ],
    (c) => (c.sessionId === ID_A ? "修 1275 的单测" : undefined),
  );
  expect(rows[0]).toBe(
    "Session                               Name  Status      Working directory  Last message",
  );
  // A session on disk only keeps its name (that is the whole point) but says so
  // instead of claiming a status, and has no message to show.
  expect(rows[2]).toBe(`${ID_B}  t1    not hosted  /repo/b            -`);
  expect(rows[1]).toContain("generating");
  expect(rows[1]).toContain("修 1275 的单测");
  // Last column is never right-padded (trailing spaces break copy-paste of the
  // id at the start of a line? no — of the message at the end).
  expect(rows.every((row) => row === row.trimEnd())).toBe(true);
});

test("renderAmbiguousRef: names the reference, the level and the candidates", () => {
  const match = matchByName(
    [
      candidate(ID_A, { name: "t1", workdir: "/repo/a" }),
      candidate(ID_B, { name: "t1", workdir: "/repo/b" }),
    ],
    "t1",
  );
  expect(match).toBeDefined();
  const lines = renderAmbiguousRef(
    "t1",
    match as Extract<typeof match, { kind: "ambiguous" }>,
    () => undefined,
  ).split("\n");
  expect(lines[0]).toBe(
    'Ambiguous session reference "t1": matches 2 sessions by name. Address one by sessionId (a unique prefix is enough):',
  );
  expect(lines[1]).toBe("");
  expect(lines[2]).toContain("Session");
  expect(lines.slice(3)).toHaveLength(2);
});

test("renderAmbiguousRef: says 'session-id prefix' when the prefix was shared", () => {
  const match = matchBySessionId([candidate(ID_A), candidate(ID_B)], "c530");
  const text = renderAmbiguousRef(
    "c530",
    match as Extract<typeof match, { kind: "ambiguous" }>,
    () => undefined,
  );
  expect(text).toContain("by session-id prefix");
});

test("describeNotFound: lists the names that do exist, sorted, or says there are none", () => {
  expect(describeNotFound("t2", ["fix-1275", "mods-x"])).toBe(
    'No session id, id prefix or name matches "t2". Known names: fix-1275, mods-x',
  );
  expect(describeNotFound("t2", [])).toBe(
    'No session id, id prefix or name matches "t2". No session on this machine has a name yet.',
  );
});
