import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { Message } from "wave-agent-sdk";

/**
 * Timeline connector geometry (设计稿: assistant 时间线竖线跨消息贯穿).
 *
 * Every message renders as a virtualized row; consecutive assistant messages
 * form a timeline run. Verifies the per-row `.timeline-row::after` segments on
 * a `.timeline-run--start` row and a `.timeline-run--end` row abut seamlessly
 * into one continuous vertical line, and that a single-dot run
 * (`.timeline-run--single`) draws no line.
 */
test.describe("Timeline connector geometry demo", () => {
  test("continuous line through a multi-assistant run; none for single run", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    const messages: Message[] = [
      {
        id: "a1",
        role: "assistant",
        timestamp: "2025-07-09T10:30:00.000Z",
        blocks: [{ type: "text", content: "First assistant message." }],
      },
      {
        id: "a2",
        role: "assistant",
        timestamp: "2025-07-09T10:30:01.000Z",
        blocks: [{ type: "text", content: "Second assistant message." }],
      },
      {
        id: "u1",
        role: "user",
        timestamp: "2025-07-09T10:30:02.000Z",
        blocks: [{ type: "text", content: "A follow-up question." }],
      },
      {
        id: "a3",
        role: "assistant",
        timestamp: "2025-07-09T10:30:03.000Z",
        blocks: [{ type: "text", content: "Third assistant message." }],
      },
    ];

    await injector.simulateExtensionMessage("setInitialState", {
      isAuthenticated: true,
      messages: [],
      isStreaming: false,
      sessions: [],
      configurationData: {
        apiKey: "sk-ant-api03-CXB9pH2k...mH8wQz",
        baseURL: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-20250514",
        fastModel: "claude-haiku-4-20250514",
      },
      permissionMode: "default",
    });

    await injector.updateMessages(messages);
    await injector.endStreaming();

    await webviewPage.waitForSelector(".virtual-row.timeline-run--start");

    // Geometry probe: read each run row's ::after segment in document
    // coordinates; the run is flush (paddingBottom 0 inside the run), so the
    // segments must abut at the row boundary.
    const geo = await webviewPage.evaluate(() => {
      const px = (v: string) => (v && v.endsWith("px") ? parseFloat(v) : NaN);
      const startRow = document.querySelector<HTMLElement>(
        ".virtual-row.timeline-run--start",
      )!;
      const endRow = document.querySelector<HTMLElement>(
        ".virtual-row.timeline-run--end",
      )!;
      const singleRow = document.querySelector<HTMLElement>(
        ".virtual-row.timeline-run--single",
      )!;

      const startMsgRow = startRow.querySelector<HTMLElement>(".timeline-row")!;
      const endMsgRow = endRow.querySelector<HTMLElement>(".timeline-row")!;
      const startRect = startMsgRow.getBoundingClientRect();
      const endRect = endMsgRow.getBoundingClientRect();

      const startAfter = getComputedStyle(startMsgRow, "::after");
      const endAfter = getComputedStyle(endMsgRow, "::after");

      // start row: line runs from the first dot center (18px) to the row
      // bottom; end row: line runs from its top to the last dot center.
      const seg1 = {
        start: startRect.top + px(startAfter.top),
        end: startRect.bottom,
        display: startAfter.display,
      };
      const seg2 = {
        start: endRect.top,
        end: endRect.top + px(endAfter.height),
        display: endAfter.display,
      };

      const firstDotCenter = startRect.top + 18;
      const lastDotCenter = endRect.top + 18;

      const singleAfter = getComputedStyle(
        singleRow.querySelector(".timeline-row") as HTMLElement,
        "::after",
      );

      return {
        startId: startRow.getAttribute("data-measured-message-id"),
        endId: endRow.getAttribute("data-measured-message-id"),
        singleIsSingleClass: singleRow.classList.contains(
          "timeline-run--single",
        ),
        seg1,
        seg2,
        firstDotCenter,
        lastDotCenter,
        singleAfterDisplay: singleAfter.display,
      };
    });

    // The run spans a1 → a2.
    expect(geo.startId).toBe("a1");
    expect(geo.endId).toBe("a2");

    // Every segment in the run is drawn (not display:none).
    expect(geo.seg1.display).not.toBe("none");
    expect(geo.seg2.display).not.toBe("none");

    // Segments abut seamlessly: seg1's end ≈ seg2's start (tolerance 1px).
    expect(Math.abs(geo.seg1.end - geo.seg2.start)).toBeLessThanOrEqual(1);

    // First segment starts at the first dot center (dot top 15 + radius 3 = 18px).
    expect(Math.abs(geo.seg1.start - geo.firstDotCenter)).toBeLessThanOrEqual(
      1,
    );

    // Last segment ends at the last dot center.
    expect(Math.abs(geo.seg2.end - geo.lastDotCenter)).toBeLessThanOrEqual(1);

    // The single-dot run draws no connecting line.
    expect(geo.singleIsSingleClass).toBe(true);
    expect(geo.singleAfterDisplay).toBe("none");
  });
});
