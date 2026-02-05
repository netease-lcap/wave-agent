import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { MarketplaceList } from "../../src/components/MarketplaceList.js";
import { KnownMarketplace } from "wave-agent-sdk";

describe("MarketplaceList", () => {
  it("should render 'No marketplaces registered' when the list is empty", () => {
    const { lastFrame } = render(
      <MarketplaceList marketplaces={[]} selectedIndex={0} />,
    );
    expect(lastFrame()).toContain("No marketplaces registered");
  });

  it("should render a list of marketplaces with correct highlighting", () => {
    const marketplaces: KnownMarketplace[] = [
      {
        name: "builtin-mp",
        source: { source: "directory", path: "/path/to/builtin" },
        isBuiltin: true,
      },
      {
        name: "github-mp",
        source: { source: "github", repo: "owner/repo" },
        isBuiltin: false,
      },
      {
        name: "url-mp",
        source: { source: "git", url: "https://example.com/marketplace.json" },
        isBuiltin: false,
      },
    ];

    const { lastFrame } = render(
      <MarketplaceList marketplaces={marketplaces} selectedIndex={1} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("builtin-mp");
    expect(frame).toContain("github-mp");
    expect(frame).toContain("url-mp");
    expect(frame).toContain("Built-in");
  });

  it("should highlight the first item when selectedIndex is 0", () => {
    const marketplaces: KnownMarketplace[] = [
      {
        name: "first-mp",
        source: { source: "directory", path: "/path/to/first" },
        isBuiltin: false,
      },
      {
        name: "second-mp",
        source: { source: "github", repo: "owner/repo" },
        isBuiltin: false,
      },
    ];

    const { lastFrame } = render(
      <MarketplaceList marketplaces={marketplaces} selectedIndex={0} />,
    );
    expect(lastFrame()).toContain("first-mp");
  });

  it("should highlight the last item when selectedIndex is the last index", () => {
    const marketplaces: KnownMarketplace[] = [
      {
        name: "first-mp",
        source: { source: "directory", path: "/path/to/first" },
        isBuiltin: false,
      },
      {
        name: "second-mp",
        source: { source: "github", repo: "owner/repo" },
        isBuiltin: false,
      },
    ];

    const { lastFrame } = render(
      <MarketplaceList marketplaces={marketplaces} selectedIndex={1} />,
    );
    expect(lastFrame()).toContain("second-mp");
  });

  it("should display [Built-in] tag for built-in marketplaces", () => {
    const marketplaces: KnownMarketplace[] = [
      {
        name: "builtin-mp",
        source: { source: "directory", path: "/path/to/builtin" },
        isBuiltin: true,
      },
    ];

    const { lastFrame } = render(
      <MarketplaceList marketplaces={marketplaces} selectedIndex={0} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("builtin-mp");
    expect(frame).toContain("Built-in");
  });
});
