import eslint from '@eslint/js';
import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/.output/**',
      '**/.wxt/**',
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '.impeccable/review/**',
      '.eval/**',
      '.fixtures/**',
    ],
  },
  eslint.configs.recommended,
  {
    files: ['scripts/eval/report-client.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        localStorage: 'readonly',
        history: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        window: 'readonly',
        location: 'readonly',
      },
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs', 'apps/desktop/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        window: 'readonly',
        document: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/extension/**/*.{ts,tsx}'],
    ignores: ['apps/extension/src/provider/chatCompletions.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@cueweave/core/provider/chatCompletions',
              message:
                'Use the extension provider adapter so model requests retain the browser permission check.',
            },
          ],
          patterns: [
            {
              group: [
                '@cueweave/desktop',
                '@cueweave/desktop/*',
                '**/apps/desktop/**',
                '**/packages/core/src/**',
              ],
              message: 'Use the shared core package exports; do not depend on another application.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/desktop/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@cueweave/extension',
                '@cueweave/extension/*',
                '**/extension/**',
                '**/packages/core/src/**',
              ],
              message: 'Use shared package exports; desktop must not import extension code.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}', 'apps/desktop/src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: builtinModules.filter((name) => !name.startsWith('_')),
          patterns: [
            {
              group: [
                'node:*',
                'electron',
                'electron/*',
                '**/main/**',
                '**/preload/**',
                '**/services/**',
                '@cueweave/extension',
                '@cueweave/extension/*',
                '**/extension/**',
                '**/packages/core/src/**',
              ],
              message:
                'Renderer and shared contracts must use the fixed desktop bridge for host operations.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'browser', 'chrome', 'window', 'document'],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'electron',
                'electron/*',
                'wxt',
                'wxt/*',
                '@cueweave/extension',
                '@cueweave/extension/*',
                '@cueweave/desktop',
                '@cueweave/desktop/*',
                '**/apps/**',
              ],
              message: 'Shared core must receive platform operations through explicit adapters.',
            },
          ],
        },
      ],
    },
  },
);
