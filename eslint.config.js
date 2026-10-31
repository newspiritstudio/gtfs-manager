import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['.next/**', 'node_modules/**', 'src/server/db/migrations/**', 'next-env.d.ts'] },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': tsPlugin, 'react-hooks': reactHooksPlugin },
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'framer-motion', message: "Use 'motion/react'." }] },
      ],
    },
  },
  {
    files: ['src/components/**', 'src/features/**', 'src/lib/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'framer-motion', message: "Use 'motion/react'." }],
          patterns: [
            {
              group: ['@/server/*'],
              allowTypeImports: true,
              message: 'Client code must not import src/server at runtime.',
            },
          ],
        },
      ],
    },
  },
];
