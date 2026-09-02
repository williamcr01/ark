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

/**
 * Packages that run only in Node (the local API, the Electron main process, the MCP server).
 * They may import `node:*`; the renderer may not import them. Everything else under `packages/`
 * is browser-safe and stays free of Node built-ins so the renderer can bundle it.
 */
const SERVER_ONLY_PACKAGES = ['agent', 'mcp', 'storage', 'deck-import']

const serverOnlyPackageFiles = SERVER_ONLY_PACKAGES.map((name) => `packages/${name}/**/*.ts`)

const boundaryPatterns = {
  renderer: [
    {
      group: ['**/apps/api/**', '@ark/api', '@ark/api/*'],
      message: 'Frontend code must not import from apps/api. Use workspace packages instead.',
    },
    {
      group: SERVER_ONLY_PACKAGES.flatMap((name) => [`@ark/${name}`, `@ark/${name}/*`]),
      message:
        'Frontend code must not import server-only packages. Shared vocabulary is re-exported from @ark/contracts.',
    },
  ],
  api: [
    {
      group: ['**/apps/desktop/**', '@ark/desktop', '@ark/desktop/*'],
      message: 'API code must not import from apps/desktop. Use workspace packages instead.',
    },
  ],
  sandbox: [
    {
      group: ['**/apps/desktop/**', '@ark/desktop', '@ark/desktop/*'],
      message: 'Sandbox code must not import from apps/desktop. Use workspace packages instead.',
    },
  ],
  packages: [
    {
      group: ['**/apps/desktop/**', '**/apps/api/**', '**/apps/sandbox/**'],
      message: 'Packages must not import from apps/.',
    },
  ],
}

const environmentOnlyPaths = [
  { name: 'react', message: 'Packages must not depend on React. Keep UI in apps/desktop.' },
  { name: 'react-dom', message: 'Packages must not depend on React. Keep UI in apps/desktop.' },
  { name: 'express', message: 'Packages must not depend on Express. Keep HTTP in apps/api.' },
]

export default defineConfig([
  globalIgnores([
    'dist',
    '**/dist/**',
    'data/**',
    'artifacts/**',
    'runtimes/**',
    '.pnpm-store/**',
    'coverage/**',
    'packages/editor-runtime/runtime/generated/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
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
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/*.{test,spec}.{ts,tsx}'],
    rules: {
      'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'warn',
        { max: 120, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },
  {
    // React Compiler lint rules in eslint-plugin-react-hooks@7 dominate wall time
    // (often >70% of rule cost) and are only needed when the compiler is enabled.
    // Ark does not use React Compiler yet, so keep the classic hooks rules only,
    // scoped to the desktop renderer.
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    extends: [reactRefresh.configs.vite],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: [
      'apps/desktop/src/components/ui/**/*.{ts,tsx}',
      'apps/desktop/src/components/ai-elements/**/*.{ts,tsx}',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    ignores: ['apps/desktop/src/hooks/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...boundaryPatterns.renderer, ...apiContractPatterns] },
      ],
    },
  },
  {
    files: ['apps/desktop/src/hooks/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            ...boundaryPatterns.renderer,
            ...apiContractPatterns,
            {
              group: ['@/components/*', '../components/*'],
              message:
                'Hooks must not import from components. Keep UI in components and have them call hooks.',
            },
          ],
        },
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
    // Every package: no imports from apps/, no environment-specific frameworks.
    files: ['packages/**/*.ts'],
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
    // Browser-safe packages additionally stay free of Node built-ins so the renderer
    // can bundle them. Server-only packages, `*-disk.ts` files, and tests are exempt.
    files: ['packages/**/*.ts'],
    ignores: [
      ...serverOnlyPackageFiles,
      'packages/**/*-disk.ts',
      // node:crypto for request-id generation; the rest of @ark/telemetry is browser-safe.
      'packages/telemetry/request-id.ts',
      'packages/**/*.test.ts',
      'packages/**/*.spec.ts',
      'packages/**/vitest.config.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...boundaryPatterns.packages,
            {
              group: ['node:*'],
              message:
                'Browser-safe packages must not use Node built-ins. Move the module to a server-only package, or make the environment explicit in the file name (*-disk.ts).',
            },
          ],
          paths: environmentOnlyPaths,
        },
      ],
    },
  },
  {
    files: ['packages/editor-runtime/runtime-src/**/*.ts'],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'no-var': 'off',
    },
  },
  eslintConfigPrettier,
])
