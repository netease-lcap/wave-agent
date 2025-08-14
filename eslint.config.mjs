import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import pluginEslintComments from 'eslint-plugin-eslint-comments';

export default [
  { ignores: ['dist/', 'node_modules/'] },
  { files: ['**/*.{js,mjs,cjs,ts,tsx}'] },
  { 
    languageOptions: { 
      globals: { ...globals.browser, ...globals.node },
      ecmaVersion: 2020,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    } 
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      react: pluginReact,
      'react-hooks': pluginReactHooks,
      'eslint-comments': pluginEslintComments,
    },
    rules: {
      ...pluginReact.configs.recommended.rules,
      ...pluginReactHooks.configs.recommended.rules,
      'react/no-unescaped-entities': 'off',
      'react/react-in-jsx-scope': 'off',
      // Prohibit eslint-disable comments
      'eslint-comments/no-use': 'error',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      'eslint-comments': pluginEslintComments,
    },
    rules: {
      // Also prohibit eslint-disable in test files
      'eslint-comments/no-use': 'error',
    },
  },
];