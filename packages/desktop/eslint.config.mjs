import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["dist/", "node_modules/", "webview/", "release/"] },
  { files: ["**/*.{js,mjs,cjs,ts,tsx}"] },
  {
    languageOptions: {
      // preload runs in the renderer (window), everything else in Node
      globals: { ...globals.browser, ...globals.node },
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
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
      // Prohibit warning comments like TODO, FIXME, eslint-disable
      "no-warning-comments": [
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
      ],
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      // Prohibit console.log in tests
      "no-console": "error",
    },
  },
  {
    // CJS shim injected by tsup — require() is intentional (same as vsce)
    files: ["scripts/import-meta-url-shim.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
