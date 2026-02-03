import React from "react";
import { render, Box } from "ink";
import {
  listSessions,
  getFirstMessageContent,
  truncateContent,
} from "wave-agent-sdk";
import { SessionSelector } from "./components/SessionSelector.js";

export async function startSessionSelectorCli(): Promise<string | null> {
  const currentWorkdir = process.cwd();
  const sessions = await listSessions(currentWorkdir);

  if (sessions.length === 0) {
    console.log(`No sessions found for workdir: ${currentWorkdir}`);
    return null;
  }

  const sessionsWithContent = await Promise.all(
    sessions.map(async (s) => {
      const content = await getFirstMessageContent(s.id, s.workdir);
      return {
        ...s,
        firstMessage: content ? truncateContent(content, 60) : "No content",
      };
    }),
  );

  return new Promise((resolve) => {
    const { unmount } = render(
      <Box padding={1}>
        <SessionSelector
          sessions={sessionsWithContent}
          onSelect={(sessionId) => {
            unmount();
            resolve(sessionId);
          }}
          onCancel={() => {
            unmount();
            resolve(null);
          }}
        />
      </Box>,
    );
  });
}
