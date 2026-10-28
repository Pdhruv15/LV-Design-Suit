import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Lint (npm run lint): rules that find real mistakes. Formatting is left to the code's own style.
export default tseslint.config(
  { ignores: ['dist/**', 'dist-cli/**', 'release/**', 'build/**', 'node_modules/**', 'engines/**', 'electron/cad/**', 'docs/**', '.archify/**', '.claude/worktrees/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }]
    }
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts', '*.ts'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules
    }
  },
  // ELV module boundary (docs/notes/Future development/ELV module boundary - decision - 2026-10-28.md): ELV and LV
  // share the core (types, rooms, exchange contracts, util, ui) and exchange loads only through src/exchange.
  // App.tsx and src/headless wire both together; tests may cross.
  {
    files: ['src/elv/**/*.ts', 'src/components/elv/ElvView.tsx'],
    ignores: ['**/*.test.*'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: [{
        group: ['**/calc/*', '!**/calc/building', '**/model/*', '**/database/*', '**/diagram/*', '**/engines/*', '**/headless/*'],
        message: 'ELV may use only the shared core (types, calc/building, exchange, util, components/ui). Send loads to LV as an exchange package.'
      }] }]
    }
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.*', 'src/elv/**', 'src/components/elv/ElvView.tsx', 'src/App.tsx', 'src/headless/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: [{
        group: ['**/elv/*', '!**/components/elv/*'], allowTypeImports: true,
        message: 'LV must not use ELV internals. Read accepted ELV loads from src/exchange (acceptedElvLoads).'
      }] }]
    }
  },
  { files: ['electron/**/*.cjs', 'tests/**/*.cjs', 'scripts/**/*.{js,cjs,mjs}'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } }, rules: { '@typescript-eslint/no-require-imports': 'off', 'no-redeclare': ['error', { builtinGlobals: false }] } }
);
