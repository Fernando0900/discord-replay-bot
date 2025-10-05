// eslint.config.cjs — ESLint v9+ flat config (CommonJS)
const js = require("@eslint/js");
const globals = require("globals");
const prettier = require("eslint-plugin-prettier");

module.exports = [
  // Ignore paths
  {
    ignores: ["node_modules/**", "dist/**", "build/**"]
  },

  // Base recommended rules
  js.configs.recommended,

  // Project rules
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs", // you're using require(...)
      globals: {
        ...globals.node
      }
    },
    plugins: {
      prettier
    },
    rules: {
      // Prettier as an ESLint rule (shows formatting issues in ESLint)
      "prettier/prettier": "error",

      // Your prefs
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
      semi: ["error", "always"],
      quotes: ["error", "double"],
      indent: ["error", 2],
      "comma-dangle": ["error", "never"]
    }
  }
];
