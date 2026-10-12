// Flat ESLint config (eslint.config.js) -- the combined "fake-string" guard.

const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

// Both custom rules, copied verbatim under ./eslint-rules/.
const noCallablePrimitiveIntersection = require('./eslint-rules/no-callable-primitive-intersection.js');
const noBrandedPrimitiveComparison = require('./eslint-rules/no-branded-primitive-comparison.js');

// Register both custom rules under a `local` plugin namespace so they can be
// referenced as `local/<name>`.
const localPlugin = {
  rules: {
    'no-callable-primitive-intersection': noCallablePrimitiveIntersection,
    'no-branded-primitive-comparison': noBrandedPrimitiveComparison,
  },
};

module.exports = [
  {
    // Global ignores (a config object with ONLY `ignores`).
    ignores: [
      'dist/**',
      'node_modules/**',
      'eslint.config.js',
      'eslint-rules/**',
    ],
  },
  {
    // Lint only files that are part of the action's tsconfig program.
    files: ['src/**/*.ts', 'globals.d.ts'],
    // Test sources are excluded from tsconfig's program.
    ignores: ['src/**/*.test.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        // Type information for the type-aware comparison rule.
        projectService: true,
        tsconfigRootDir: __dirname,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      // Custom rules live here -> referenced as `local/...`.
      local: localPlugin,
      // The official TS plugin supplies `@typescript-eslint/no-wrapper-object-types`.
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'local/no-callable-primitive-intersection': 'error',

      'local/no-branded-primitive-comparison': 'error',

      'no-new-wrappers': 'error',

      '@typescript-eslint/no-wrapper-object-types': 'error',

      //     path that `no-new-wrappers` does NOT catch.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='Object'][arguments.length=1]",
          message:
            'Do not box a value with Object(...) -- it produces a wrapper object (the boxed-stream regression). Use the primitive directly.',
        },
      ],
    },
  },
];
