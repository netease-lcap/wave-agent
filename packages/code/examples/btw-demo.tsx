import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/components/App.js";
import { stripAnsiColors } from "wave-agent-sdk";
import { INPUT_PLACEHOLDER_TEXT_PREFIX } from "../src/components/InputBox.js";

async function testBtw() {
  try {
    console.log("🚀 Starting /btw demo...");
    const { stdin, lastFrame, unmount } = render(<App onExit={() => {}} />);

    const waitFor = async (
      condition: () => boolean,
      timeout = 10000,
      interval = 100,
    ) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (condition()) return;
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
      throw new Error("Timeout waiting for condition");
    };

    // Wait for app to initialize
    await waitFor(() =>
      stripAnsiColors(lastFrame() || "").includes(
        INPUT_PLACEHOLDER_TEXT_PREFIX,
      ),
    );
    console.log("✅ App initialized.");

    // Type /btw command
    console.log("⌨️ Typing /btw what is the capital of France?...");
    stdin.write("/btw what is the capital of France?");

    // Verify text is in input box
    await waitFor(() => stripAnsiColors(lastFrame() || "").includes("France?"));

    // Press Enter
    console.log("⌨️ Pressing Enter...");
    stdin.write("\r");

    // Wait for BTW display to appear
    console.log("⏳ Waiting for BY THE WAY display...");
    await waitFor(() =>
      stripAnsiColors(lastFrame() || "").includes("BY THE WAY"),
    );
    console.log("✅ BY THE WAY display appeared.");

    // Wait for answer
    console.log("⏳ Waiting for AI answer...");
    await waitFor(
      () => stripAnsiColors(lastFrame() || "").includes("Paris"),
      20000,
    );
    console.log("✅ AI answer received.");

    // Press ESC to dismiss
    console.log("⌨️ Pressing ESC to dismiss...");
    stdin.write("\u001B"); // ESC key

    // Wait for BTW display to disappear
    await waitFor(
      () => !stripAnsiColors(lastFrame() || "").includes("BY THE WAY"),
    );
    console.log("✅ BY THE WAY display dismissed.");

    // Test /btw again to ensure state was cleared
    console.log("⌨️ Typing /btw again to check if state was cleared...");
    stdin.write("/btw");
    await new Promise((resolve) => setTimeout(resolve, 500));
    stdin.write("\r");

    await waitFor(() =>
      stripAnsiColors(lastFrame() || "").includes("BY THE WAY"),
    );

    const frame = stripAnsiColors(lastFrame() || "");
    if (frame.includes("Paris") || frame.includes("France")) {
      throw new Error("Old state was not cleared!");
    }
    console.log("✅ Old state was cleared successfully.");

    // Clean up resources
    unmount();
    console.log("\n✨ Demo completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Demo failed:", error);
    process.exit(1);
  }
}

// Add error handling
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Promise rejection:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

testBtw().catch((error) => {
  console.error("❌ Error occurred while running demo:", error);
  process.exit(1);
});
