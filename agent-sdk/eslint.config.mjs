import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/', 'node_modules/'] },
  { files: ['**/*.{js,mjs,cjs,ts,tsx}'] },
  { 
    languageOptions: { 
      globals: { ...globals.node },
      ecmaVersion: 2020,
      sourceType: 'module',
    } 
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Prohibit warning comments like TODO, FIXME, eslint-disable
      'no-warning-comments': ['error', {
        terms: ['todo', 'fixme', 'hack', 'bug', 'eslint-disable', 'eslint-disable-line', 'eslint-disable-next-line'],
        location: 'anywhere',
      }],
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Also prohibit warning comments in test files
      'no-warning-comments': ['error', {
        terms: ['todo', 'fixme', 'hack', 'bug', 'eslint-disable', 'eslint-disable-line', 'eslint-disable-next-line'],
        location: 'anywhere',
      }],
    },
  },
  {
    files: ['scripts/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Scripts can have more relaxed rules
      'no-warning-comments': ['error', {
        terms: ['todo', 'fixme', 'hack', 'bug', 'eslint-disable', 'eslint-disable-line', 'eslint-disable-next-line'],
        location: 'anywhere',
      }],
      // Allow console.log in scripts
      'no-console': 'off',
    },
  },
];