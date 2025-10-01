import tsPlugin from "@typescript-eslint/eslint-plugin";

const commonJsBanRules = {
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "CallExpression[callee.name='require']",
        message: "Use ES module import instead of require.",
      },
      {
        selector: "MemberExpression[object.name='module'][property.name='exports']",
        message: "Use ES module export instead of module.exports.",
      },
    ],
    // Don't enforce const over let
    "prefer-const": "off",

    "@typescript-eslint/no-wrapper-object-types": "off",

    // Disable unused vars
    "@typescript-eslint/no-unused-vars": "off",

    // Disable 'unknown'
    "@typescript-eslint/no-explicit-unknown": "off",

    // Disable 'any' type errors
    "@typescript-eslint/no-explicit-any": "off",

    // Allow use of @ts-ignore comments
    "@typescript-eslint/ban-ts-comment": "off",

    // Ignore missing type safety (like ts(2345))
    "@typescript-eslint/strict-boolean-expressions": "off",
    "@typescript-eslint/no-unnecessary-condition": "off",
  },
};

export default [
  {
    extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
    plugins: { "@typescript-eslint": tsPlugin },
    ...commonJsBanRules,
  },
];
