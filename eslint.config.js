import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", ".test-dist/**", ".benchmark-dist/**", ".benchmark-output/**", "node_modules/**", ".npm-cache-temp/**", ".portable-node/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((configuration) => ({
    ...configuration,
    files: ["src/**/*.ts", "test/**/*.ts", "benchmarks/src/**/*.ts"],
  })),
  {
    files: ["src/**/*.ts", "test/**/*.ts", "benchmarks/src/**/*.ts"],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-confusing-void-expression": "error",
    },
  },
  {
    files: ["*.js", "scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/adapters/studio/assets/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    // Visual verification asserts against a real page, so its evaluate callbacks use browser globals.
    files: ["scripts/visual-capture.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
);
