import type { MessageInjector } from "../e2e/utils/messageInjector.js";

/**
 * Sidebar session-tree seeding for desktop screenshots.
 *
 * The desktop host pushes `desktopSessionTree` to fill the sidebar session
 * list; screenshots that show a conversation list without it render an empty
 * sidebar ("太假"). Call after `desktopWorkdirState` + `waitForChatAppReady`
 * (DesktopApp's message listener must be live) and before screenshots.
 * Demo-specific titles keep the list matching each workdir/context.
 */

export interface SeedSession {
  sessionId: string;
  title: string;
  running?: boolean;
  waitingConfirmation?: boolean;
  hasWorktree?: boolean;
  /** Optional override; default = fixed demo clock, newest first. */
  lastActiveAt?: number;
}

// Fixed demo clock so screenshots are deterministic (newest session first).
const DEMO_CLOCK = 1782000000000;

export async function seedSidebarSessions(
  injector: MessageInjector,
  workdir: string,
  sessions: SeedSession[],
  host = "local",
): Promise<void> {
  await injector.simulateExtensionMessage("desktopSessionTree", {
    groups: [
      {
        host,
        workdir,
        sessions: sessions.map((s, i) => ({
          sessionId: s.sessionId,
          title: s.title,
          lastActiveAt: s.lastActiveAt ?? DEMO_CLOCK - i * 60_000,
          hasWorktree: s.hasWorktree ?? false,
          running: s.running ?? false,
          waitingConfirmation: s.waitingConfirmation ?? false,
        })),
      },
    ],
  });
}
