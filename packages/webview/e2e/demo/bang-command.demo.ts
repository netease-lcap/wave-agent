import { test } from "../utils/webviewTestHarness.js";
import { MessageInjector } from "../utils/messageInjector.js";
import { MockDataGenerator } from "../fixtures/mockData.js";
import { screenshotWebp } from "../utils/screenshot.js";

test.describe("Bang Command Demo", () => {
  test("should demonstrate bang command execution and output", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    // 1. Show a successful command with output
    await injector.updateMessages([
      MockDataGenerator.createBangMessage(
        "kubectl get pods -n payment",
        "NAME                            READY   STATUS    RESTARTS   AGE\npayment-service-7f4d           1/1     Running   0          2d\npayment-worker-9c2a            1/1     Running   0          2d\npayment-scheduler-5x8b         1/1     Running   0          5h",
        false,
        0,
      ),
    ]);
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/bang-command-success.webp",
    );

    // 2. Show a long output
    const longOutput = Array.from(
      { length: 20 },
      (_, i) => `Test suite ${i + 1} passed`,
    ).join("\n");
    await injector.updateMessages([
      MockDataGenerator.createBangMessage("pnpm test", longOutput, false, 0),
    ]);
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/bang-command-long-output.webp",
    );
  });
});
