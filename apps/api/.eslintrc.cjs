/**
 * ESLint for the API.
 * =========================================================================
 * Same convention as apps/web and apps/print-agent — ESLint 8, eslintrc
 * format, `prettier` last — on a typescript-eslint base rather than `next/*`.
 *
 * `.cjs` so `tsconfigRootDir` can be `__dirname`; see the print agent's config
 * for the full reasoning.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'prettier',
  ],
  env: { node: true, es2022: true },
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': [
      'warn',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],

    /** An unawaited write in a request handler responds before the work lands. */
    '@typescript-eslint/no-floating-promises': 'error',

    /**
     * `checksVoidReturn.arguments` is off, and only that sub-check.
     *
     * It fires on every `router.get('/x', async (req, res) => …)` — 109 of them
     * — because Express's own types declare handlers as returning void. In this
     * codebase that is a FALSE POSITIVE: `createRouter()` in lib/router.ts wraps
     * every handler as it is registered and routes rejections into `next(err)`,
     * which is precisely the guarantee this check exists to demand. Verified by
     * reading that file, not assumed.
     *
     * Every other void-return check stays on, as does no-floating-promises —
     * the rule that would actually catch a dropped await.
     */
    '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { arguments: false } }],
  },
  overrides: [
    {
      // Operator tooling, run by hand with tsx and deliberately outside
      // tsconfig.json (it is not part of the build). No tsconfig means no type
      // information, so the type-aware rules have to come off with it —
      // otherwise they crash rather than lint. stdout is these files' whole
      // interface, so console is expected.
      files: ['scripts/**/*.ts'],
      parserOptions: { project: null },
      extends: ['plugin:@typescript-eslint/disable-type-checked'],
      rules: {
        'no-console': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
  ignorePatterns: ['node_modules', 'dist', '.turbo'],
};
