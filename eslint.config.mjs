import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/", "node_modules/"] },
  { files: ["**/*.{js,mjs,cjs,ts,tsx}"] },
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      ecmaVersion: 2020,
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
      ...pluginReact.configs.recommended.rules,
      ...pluginReactHooks.configs.recommended.rules,
      "react/no-unescaped-entities": "off",
      "react/react-in-jsx-scope": "off",
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
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Also prohibit warning comments in test files
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
    files: ["scripts/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Scripts can have more relaxed rules
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
      // Allow console.log in scripts
      "no-console": "off",
    },
  },
];
