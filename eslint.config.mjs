import next from 'eslint-config-next/core-web-vitals';

/**
 * Next 16's eslint-config-next ships a native flat config array, so we spread it
 * directly (no FlatCompat — that path hits a circular-JSON validation bug on
 * ESLint 9.39+).
 */
const eslintConfig = [
  ...next,
  {
    ignores: ['.next/**', 'node_modules/**', 'e2e/**', 'supabase/**'],
  },
];

export default eslintConfig;
