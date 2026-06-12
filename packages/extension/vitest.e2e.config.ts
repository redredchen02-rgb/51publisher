import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"#imports": path.resolve(__dirname, "tests/e2e/stubs/wxt-imports.ts"),
		},
	},
	test: {
		include: ["tests/e2e/**/*.test.ts"],
		environment: "jsdom",
		globals: true,
		testTimeout: 10000,
	},
});
