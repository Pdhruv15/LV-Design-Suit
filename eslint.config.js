import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Lint (npm run lint): rules that find real mistakes. Formatting is left to the code's own style.
export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'build/**', 'node_modules/**', 'engines/**', 'docs/**', '.archify/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      // The code's idiom: \`cond ? a() : b()\` and \`x && f()\` as statements.
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true, allowShortCircuit: true }],
      // \`catch {}\`: best-effort steps (backups, cleanup) that may fail silently by design.
      'no-empty': ['error', { allowEmptyCatch: true }]
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
  { files: ['electron/**/*.cjs', 'tests/**/*.cjs', 'scripts/**/*.{js,cjs,mjs}'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } }, rules: { '@typescript-eslint/no-require-imports': 'off', 'no-redeclare': ['error', { builtinGlobals: false }] } }
);
