#!/usr/bin/env node

// Import and start the ACP CLI
import("../dist/acp-cli.js")
  .then(async ({ runAcp }) => {
    try {
      await runAcp();
    } catch (err) {
      console.error("Failed to start ACP CLI:", err);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("Failed to import ACP CLI module:", err);
    process.exit(1);
  });
