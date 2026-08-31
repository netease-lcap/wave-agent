/**
 * WelcomeView - Brand mark for the empty / new-conversation state.
 *
 * Shown in place of MessageList when there are no messages yet. On desktop the
 * surrounding layout centers this brand mark together with the input card
 * (`.chat-container--welcome`); on IDE hosts it centers on its own. The login
 * entry lives in the chat header (IDE hosts) or the sidebar account card
 * (desktop) instead of the welcome page.
 *
 * Design ref: designer welcome scene — large "Codewave. IDE" wordmark as the
 * sole visual focus above the input card (spec 场景 5).
 */

import React from "react";
import { CodewaveLogo } from "./CodewaveLogo";

const WelcomeView: React.FC = () => {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "24px",
          padding: "0 16px",
        }}
      >
        {/* Brand wordmark (same SVG as the designer welcome scene's logo) */}
        <div data-testid="welcome-wordmark">
          <CodewaveLogo height={24} />
        </div>
      </div>
    </div>
  );
};

export default WelcomeView;
