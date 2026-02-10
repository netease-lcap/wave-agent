import { render } from "ink-testing-library";
import React from "react";
import { describe, it, expect } from "vitest";
import { AppProvider, useAppConfig } from "../../src/contexts/useAppConfig.js";

describe("AppProvider", () => {
  it("provides config values to children", () => {
    let capturedConfig: ReturnType<typeof useAppConfig> | undefined;
    function TestComponent() {
      capturedConfig = useAppConfig();
      return null;
    }

    render(
      <AppProvider restoreSessionId="test-session" continueLastSession={true}>
        <TestComponent />
      </AppProvider>,
    );

    expect(capturedConfig).toEqual({
      restoreSessionId: "test-session",
      continueLastSession: true,
    });
  });

  it("provides undefined values when not provided", () => {
    let capturedConfig: ReturnType<typeof useAppConfig> | undefined;
    function TestComponent() {
      capturedConfig = useAppConfig();
      return null;
    }

    render(
      <AppProvider restoreSessionId={undefined} continueLastSession={undefined}>
        <TestComponent />
      </AppProvider>,
    );

    expect(capturedConfig).toEqual({
      restoreSessionId: undefined,
      continueLastSession: undefined,
    });
  });

  // it("throws error when useAppConfig is used outside of AppProvider", () => {
  //   const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  //   const TestComponent = () => {
  //     useAppConfig();
  //     return null;
  //   };

  //   expect(() => {
  //     try {
  //       render(<TestComponent />);
  //     } catch (e) {
  //       throw new Error("Caught: " + (e as Error).message);
  //     }
  //   }).toThrow();
  //   consoleSpy.mockRestore();
  // });
});
