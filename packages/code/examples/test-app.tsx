import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/components/App.js";
import {
  waitForText,
  waitForTextToDisappear,
} from "../tests/helpers/waitHelpers.js";

// Delay function as a complement to waitHelper
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function testApp() {
  console.log("🧪 Start testing App component");

  try {
    // Render App component
    console.log("📦 Rendering App component...");
    const { stdin, lastFrame, unmount } = render(<App />);

    // Wait for initial render to complete - wait for welcome message to appear
    console.log("⏳ Waiting for initial render to complete...");
    await waitForText(lastFrame, "Welcome to WAVE Code Assistant!");
    console.log("✅ Initial render completed");

    // Show initial state
    console.log("\n📸 Initial interface state:");
    console.log(lastFrame());

    // Simulate inputting "hi"
    console.log("\n⌨️ Simulating input 'hi'...");
    stdin.write("hi");

    // Wait for input processing
    await delay(50); // Basic delay to ensure input is processed

    // Show state after input
    console.log("📸 Interface state after inputting 'hi':");
    console.log(lastFrame());

    // Simulate pressing Enter key to send message
    console.log("\n↵ Simulating pressing Enter key to send message...");
    stdin.write("\r"); // Enter key

    // Show state after sending message
    console.log("📸 Interface state after sending message:");
    console.log(lastFrame());

    console.log("✅ User message sent");

    // Wait for AI to start thinking
    console.log("⏳ Waiting for AI to start thinking...");
    await waitForText(lastFrame, "AI is thinking");

    // Wait for AI response to complete
    console.log("⏳ Waiting for AI response...");
    await waitForTextToDisappear(lastFrame, "AI is thinking", {
      timeout: 20 * 1000,
    });
    console.log("✅ AI has responded!");
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
