import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier/flat'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const boundaryPatterns = {
  src: [
    {
      group: ['**/server/*', '../server/*', '../server/**', 'server/*', 'server/**'],
      message: 'Frontend code must not import from server/. Use shared/ instead.',
    },
  ],
  server: [
    {
      group: ['**/src/*', '../src/*', '../src/**', 'src/*', 'src/**'],
      message: 'Server code must not import from src/. Use shared/ instead.',
    },
  ],
  shared: [
    {
      group: ['**/src/*', '../src/*', '../src/**', 'src/*', 'src/**'],
      message: 'Shared code must not import from src/.',
    },
    {
      group: ['**/server/*', '../server/*', '../server/**', 'server/*', 'server/**'],
      message: 'Shared code must not import from server/.',
    },
  ],
}

const environmentOnlyPaths = [
  { name: 'react', message: 'Shared code must not depend on React. Keep UI in src/.' },
  { name: 'react-dom', message: 'Shared code must not depend on React. Keep UI in src/.' },
  { name: 'express', message: 'Shared code must not depend on Express. Keep HTTP in server/.' },
]

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}', 'src/components/ai-elements/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: boundaryPatterns.src }],
    },
  },
  {
    files: ['server/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: boundaryPatterns.server }],
    },
  },
  {
    files: ['shared/**/*.ts'],
    ignores: ['shared/**/*.test.ts', 'shared/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...boundaryPatterns.shared,
            {
              group: ['node:*'],
              message:
                'Shared code must not use Node built-ins unless the file name makes the environment explicit (e.g. *-disk.ts).',
            },
          ],
          paths: environmentOnlyPaths,
        },
      ],
    },
  },
  {
    files: ['shared/**/*-disk.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: boundaryPatterns.shared,
          paths: environmentOnlyPaths,
        },
      ],
    },
  },
  {
    files: ['shared/**/*.test.ts', 'shared/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: boundaryPatterns.shared,
          paths: environmentOnlyPaths,
        },
      ],
    },
  },
  eslintConfigPrettier,
])
