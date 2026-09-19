import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";

/**
 * design.md §13.1 lists eslint-plugin-jsx-a11y as part of the stack, and §12
 * targets WCAG 2.2 AA. The a11y rules below are errors, not warnings: the
 * commitments they protect are in a document that gets defended, and a warning
 * nobody reads is not a commitment.
 */
export default tseslint.config(
  { ignores: ["dist", "coverage"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // §12: every control reachable and labelled.
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/anchor-has-content": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-proptypes": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/label-has-associated-control": [
        "error",
        { assert: "either", depth: 3 },
      ],
      "jsx-a11y/no-autofocus": "error",
      "jsx-a11y/no-redundant-roles": "error",
      "jsx-a11y/role-has-required-aria-props": "error",

      // §11.3 / §13.5: no user-agent sniffing, no view switchers.
      "no-restricted-properties": [
        "error",
        {
          object: "navigator",
          property: "userAgent",
          message:
            "design.md §13.5: layout follows viewport width, never the user agent. Use useBreakpoint or a media query.",
        },
      ],

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    /**
     * The router module exports a route configuration object, not a component,
     * which is exactly the shape react-refresh cannot verify. Restructuring the
     * router to satisfy the rule would make it worse, so the rule is off here
     * and nowhere else.
     */
    files: ["src/app/router.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    // Tests may reach for DOM globals and node APIs.
    files: ["**/*.test.{ts,tsx}", "src/test/**"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
);
