module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Explicitly specify how to process TypeScript files
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.test.json", // Use test-specific compiler settings
      },
    ],
  },
  // File extensions Jest should resolve
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  // Skip compiled tests and dependencies
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  // Ignore transforms for dependencies
  transformIgnorePatterns: ["/node_modules/"],
};
