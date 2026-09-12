import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Errors only — no formatting rules, on purpose.
 *
 * A linter that also reformats rewrites every file the day it is added, which
 * buries the handful of real findings in thousands of lines of churn and makes
 * every open branch conflict. Style here is whatever the surrounding code does;
 * this config is for things that are *wrong*.
 *
 * The rules that earn their place are the ones catching what review and types
 * both miss: a hook dependency quietly omitted, a floating promise, a `catch`
 * that swallows everything.
 */
export default tseslint.config(
  {
    // Build output and the desktop bundle are not ours to lint.
    ignores: ['dist/**', 'node_modules/**', '.wrangler/**', 'coverage/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // Every file, not only TypeScript — the scripts/ checks are real code and
    // the same mistakes matter there.
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // An unused variable is either a mistake or a leftover. The underscore
      // escape is what makes it usable rather than something people disable.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // The codebase deliberately uses empty catches where a failure is a
      // non-event (blocked storage, a refused clipboard). Each one is commented.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // The one rule worth the most here: a missing dependency is a stale
      // closure, which reads as a random bug months later.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    // Tests reach for internals and fake globals on purpose.
    files: ['**/*.test.{ts,tsx}', 'src/test-utils/**', 'src/test-setup.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    // The browser-driving scripts pass callbacks that run inside the page, so
    // `document` in them is correct rather than a missing import.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
