#!/usr/bin/env node

// Import and start the CLI
import("../dist/index.js")
  .then(async ({ main }) => {
    try {
      await main();
    } catch (err) {
      console.error("Failed to start CLI:", err);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("Failed to import CLI module:", err);
    process.exit(1);
  });
