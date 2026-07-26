import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/coverage/**",
      "**/dist/**",
      "**/dist-electron/**",
      "**/node_modules/**",
      "apps/desktop/.release-runtime/**",
      "apps/desktop/.release-project/**",
      "release/**",
      "**/playwright-report/**",
      "**/test-results/**"
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node
    }
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    files: [
      "apps/desktop/src/renderer/**/*.{ts,tsx}",
      "packages/testing/tests/**/*.{ts,tsx}"
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      "react-hooks": reactHooks
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error"
    }
  },
  {
    // Legacy fixture and browser-bridge mocks predate strict typing; correctness rules remain enabled.
    files: [
      "packages/testing/tests/api-provider-infrastructure.test.ts",
      "packages/testing/tests/assets.test.ts",
      "packages/testing/tests/desktop-settings-store.test.ts",
      "packages/testing/tests/execution-engine.test.ts",
      "packages/testing/tests/graph-assembly.test.ts",
      "packages/testing/tests/graph-catalog.test.ts",
      "packages/testing/tests/graph-taxonomy-25.test.ts",
      "packages/testing/tests/job-coordinator.test.ts",
      "packages/testing/tests/provider-registry.test.ts",
      "packages/testing/tests/smoke.spec.ts",
      "packages/testing/tests/vision-evaluation.test.ts"
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  {
    files: [
      "apps/desktop/src/main/**/*.ts",
      "apps/desktop/src/preload/**/*.ts",
      "apps/desktop/*.ts",
      "packages/**/*.ts",
      "scripts/**/*.{js,mjs,cjs}"
    ],
    languageOptions: {
      globals: globals.node
    }
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error"
    }
  }
);
