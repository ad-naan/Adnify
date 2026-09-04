module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  ignorePatterns: ['node_modules/', 'dist/', 'release/', 'tmp/', '.pnpm-store/'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    'no-undef': 'off',
    'no-case-declarations': 'off',
  },
  overrides: [
    {
      // These Node scripts execute as CommonJS, not TypeScript modules.
      files: ['scripts/**/*.js', '*.cjs'],
      parserOptions: { sourceType: 'script' },
      rules: { '@typescript-eslint/no-var-requires': 'off' },
    },
  ],
}
