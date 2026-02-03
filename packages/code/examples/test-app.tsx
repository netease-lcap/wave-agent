import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/components/App.js";
import { stripAnsiColors } from "wave-agent-sdk";
import { INPUT_PLACEHOLDER_TEXT_PREFIX } from "@/components/InputBox.js";

async function testApp() {
  try {
    const { stdin, lastFrame, unmount } = render(<App />);

    const waitFor = async (
      condition: () => boolean,
      timeout = 5000,
      interval = 50,
    ) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (condition()) return;
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
      throw new Error("Timeout");
    };

    await waitFor(() =>
      stripAnsiColors(lastFrame() || "").includes(
        INPUT_PLACEHOLDER_TEXT_PREFIX,
      ),
    );

    // await delay(10);

    stdin.write("hello");
    await waitFor(
      () =>
        !stripAnsiColors(lastFrame() || "").includes(
          INPUT_PLACEHOLDER_TEXT_PREFIX,
        ),
    );

    stdin.write("\r"); // Enter key

    await waitFor(() =>
      stripAnsiColors(lastFrame() || "").includes("AI is thinking"),
    );

    await waitFor(
      () => !stripAnsiColors(lastFrame() || "").includes("AI is thinking"),
      20 * 1000,
    );
    console.log("📸 Interface state after AI response:");
    console.log(lastFrame());

    // Clean up resources
    unmount();
    console.log("\n✨ Test completed!");
  } catch (error) {
    console.error("❌ Test failed:", error);
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

// Run test
testApp().catch((error) => {
  console.error("❌ Error occurred while running test:", error);
  process.exit(1);
});
