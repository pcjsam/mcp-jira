/**
 * Jest runs the TypeScript sources directly through @swc/jest (type-stripping
 * only; `npm run typecheck:test` covers the types). The project is ESM with
 * nodenext resolution, so imports name `.js` files that only exist after
 * build — moduleNameMapper strips the suffix so Jest resolves the `.ts` source.
 */
export default {
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  transform: {
    "^.+\\.ts$": [
      "@swc/jest",
      { jsc: { parser: { syntax: "typescript" }, target: "es2022" }, module: { type: "es6" } },
    ],
  },
  collectCoverageFrom: ["src/adf.ts", "src/format.ts"],
  coverageThreshold: { global: { branches: 90, functions: 100, lines: 95, statements: 95 } },
};
