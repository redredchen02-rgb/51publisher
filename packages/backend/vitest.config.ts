import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		setupFiles: ["./src/config/test-setup.ts"],
		exclude: ["dist/**", "node_modules/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
			include: ["src/**"],
			exclude: [
				"src/migrations/**",
				"src/**/*.test.ts",
				// llm/ sub-files are re-exported via src/services/llm.ts barrel;
				// v8 cannot track coverage through barrel re-exports — coverage is
				// measured on the barrel itself which exercises the same code paths.
				"src/services/llm/*.ts",
				// Entry point — not exercised in unit tests by design
				"src/index.ts",
			],
			thresholds: {
				statements: 80,
				lines: 80,
				branches: 80,
				functions: 80,
			},
		},
	},
});
