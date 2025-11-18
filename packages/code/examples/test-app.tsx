import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/components/App.js";
import {
  waitForText,
  waitForTextToDisappear,
} from "../tests/helpers/waitHelpers.js";
import { INPUT_PLACEHOLDER_TEXT_PREFIX } from "@/components/InputBox.js";

async function testApp() {
  try {
    const { stdin, lastFrame, unmount } = render(<App />);

    await waitForText(lastFrame, INPUT_PLACEHOLDER_TEXT_PREFIX);

    // await delay(10);

    stdin.write("hello");
    await waitForTextToDisappear(lastFrame, INPUT_PLACEHOLDER_TEXT_PREFIX);

    stdin.write("\r"); // Enter key

    await waitForText(lastFrame, "AI is thinking");

    await waitForTextToDisappear(lastFrame, "AI is thinking", {
      timeout: 20 * 1000,
    });
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
