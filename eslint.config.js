import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier/flat'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const apiContractPatterns = [
  {
    group: ['@ark/contracts/*', '**/packages/contracts/!(index)*'],
    message: 'Import API contracts from @ark/contracts only.',
  },
]

const boundaryPatterns = {
  web: [
    {
      group: ['**/apps/api/**', '@ark/api', '@ark/api/*'],
      message: 'Frontend code must not import from apps/api. Use workspace packages instead.',
    },
  ],
  api: [
    {
      group: ['**/apps/web/**', '@ark/web', '@ark/web/*'],
      message: 'API code must not import from apps/web. Use workspace packages instead.',
    },
  ],
  sandbox: [
    {
      group: ['**/apps/web/**', '@ark/web', '@ark/web/*'],
      message: 'Sandbox code must not import from apps/web. Use workspace packages instead.',
    },
  ],
  packages: [
    {
      group: ['**/apps/web/**', '**/apps/api/**', '**/apps/sandbox/**'],
      message: 'Packages must not import from apps/.',
    },
  ],
}

const environmentOnlyPaths = [
  { name: 'react', message: 'Packages must not depend on React. Keep UI in apps/web.' },
  { name: 'react-dom', message: 'Packages must not depend on React. Keep UI in apps/web.' },
  { name: 'express', message: 'Packages must not depend on Express. Keep HTTP in apps/api.' },
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
    files: [
      'apps/web/src/components/ui/**/*.{ts,tsx}',
      'apps/web/src/components/ai-elements/**/*.{ts,tsx}',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...boundaryPatterns.web, ...apiContractPatterns] },
      ],
    },
  },
  {
    files: ['apps/api/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...boundaryPatterns.api, ...apiContractPatterns] },
      ],
    },
  },
  {
    files: ['apps/sandbox/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: boundaryPatterns.sandbox }],
    },
  },
  {
    files: ['packages/**/*.ts'],
    ignores: ['packages/**/*.test.ts', 'packages/**/*.spec.ts', 'packages/**/vitest.config.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...boundaryPatterns.packages,
            {
              group: ['node:*'],
              message:
                'Packages must not use Node built-ins unless the file name makes the environment explicit (e.g. *-disk.ts).',
            },
          ],
          paths: environmentOnlyPaths,
        },
      ],
    },
  },
  {
    files: ['packages/**/*-disk.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: boundaryPatterns.packages,
          paths: environmentOnlyPaths,
        },
      ],
    },
  },
  {
    files: ['packages/contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: boundaryPatterns.packages,
          paths: environmentOnlyPaths,
        },
      ],
    },
  },
  {
    files: ['packages/**/*.test.ts', 'packages/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: boundaryPatterns.packages,
          paths: environmentOnlyPaths,
        },
      ],
    },
  },
  eslintConfigPrettier,
])
