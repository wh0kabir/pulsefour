import astro from 'eslint-plugin-astro';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', '.astro/**', 'node_modules/**', 'data/raw/**'] },

  ...tseslint.configs.recommended,
  ...astro.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Unused args are fine when prefixed with an underscore.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    // src/sim must stay pure: no DOM, no React, no browser globals beyond
    // Web Crypto and postMessage (section 0, rule 8). Enforced by review for
    // now; the import boundary gets a lint rule when the engine lands.
    files: ['src/sim/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
