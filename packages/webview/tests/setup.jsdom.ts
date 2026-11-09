import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/**
 * jsdom setup for the small set of specs that need a DOM but cannot run in the
 * browser project (they import node-only SDK modules). Deliberately free of the
 * layout polyfills the old shared setup carried — keeping a second copy of them
 * here would quietly recreate the fake geometry the browser migration removed.
 */
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});
vi.spyOn(console, "info").mockImplementation(() => {});
vi.spyOn(console, "debug").mockImplementation(() => {});
