import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";

// Prohibit warning comments like TODO, FIXME, eslint-disable
const noWarningComments = [
  "error",
  {
    terms: [
      "todo",
      "fixme",
      "hack",
      "bug",
      "eslint-disable",
      "eslint-disable-line",
      "eslint-disable-next-line",
    ],
    location: "anywhere",
  },
];

export default [
  { ignores: ["dist/", "node_modules/", "coverage/"] },
  { files: ["**/*.{js,mjs,cjs,ts,tsx}"] },
  {
    languageOptions: {
      // The webview bundle is a pure browser environment (IIFE, window/document)
      globals: { ...globals.browser },
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
    },
    rules: {
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": true,
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
        },
      ],
      ...pluginReact.configs.recommended.rules,
      ...pluginReactHooks.configs.recommended.rules,
      "react/no-unescaped-entities": "off",
      "react/react-in-jsx-scope": "off",
      // VS Code <webview> custom attributes (src/components/PreviewPane.tsx)
      "react/no-unknown-property": [
        "error",
        { ignore: ["preload", "webpreferences"] },
      ],
      "no-warning-comments": noWarningComments,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    // Unit tests run under jsdom with vitest globals (vitest.config.ts: globals: true)
    files: ["tests/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.vitest,
      },
    },
    rules: {
      // Prohibit console.log in tests
      "no-console": "error",
      "no-warning-comments": noWarningComments,
    },
  },
  {
    // Playwright demo tests (e2e), build scripts and config files run in Node
    files: [
      "e2e/**/*.{ts,tsx}",
      "scripts/**/*.{js,mjs,cjs}",
      "esbuild.config.mjs",
      "vitest.config.ts",
      "playwright.config.ts",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      // e2e/utils log page errors to the terminal on failure
      "no-console": "off",
      // Playwright fixtures call use(page) — not React hooks
      "react-hooks/rules-of-hooks": "off",
      "no-warning-comments": noWarningComments,
    },
  },
];
