/**
 * ESLint for the print agent.
 * =========================================================================
 * Same convention as apps/web — ESLint 8, eslintrc format, `prettier` last so
 * formatting rules are switched off rather than fought — but based on
 * typescript-eslint instead of `next/*`, which would pull React and Next rules
 * into a headless Node program.
 *
 * `.cjs` rather than `.json` for one reason: `tsconfigRootDir` must be an
 * ABSOLUTE path, and only a JS config can say `__dirname`. Relying on the
 * process's cwd instead breaks the moment turbo runs lint from the repo root.
 *
 * TYPE-AWARE LINTING IS ON (`recommended-requiring-type-checking`). It is
 * slower, and it is the point: this is the one component nobody can fix
 * remotely once it is on a shop PC, and the rules that matter here —
 * no-floating-promises above all — cannot be checked without types.
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

    /**
     * A dropped promise in this agent is a print that silently never happens,
     * or a marker never written. There is no user watching a console to notice.
     */
    '@typescript-eslint/no-floating-promises': 'error',

    /**
     * console.log has no level, no timestamp and does not reach the log file
     * the installer tails — so it is invisible on the machine that matters.
     * Use the logger. src/logger.ts is the one place allowed to write directly.
     */
    'no-console': 'error',
  },
  overrides: [
    {
      // The logger IS the console wrapper; it cannot use itself.
      files: ['src/logger.ts'],
      rules: { 'no-console': 'off' },
    },
    {
      // Build tooling: plain Node, outside the tsconfig, and printing to stdout
      // is its whole job.
      //
      // `disable-type-checked` is required, not tidiness: an eslintrc override
      // MERGES with the parent's `extends`, so the type-aware rules stay switched
      // on and then crash on a file the parser has no type information for.
      files: ['scripts/**/*.mjs'],
      parserOptions: { project: null },
      extends: ['plugin:@typescript-eslint/disable-type-checked'],
      rules: {
        'no-console': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
      },
    },
  ],
  ignorePatterns: ['node_modules', 'dist', '.turbo', '*.d.ts'],
};
