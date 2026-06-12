// WXT auto-import stub for e2e tests (jsdom, no WxtVitest plugin).
// All I/O is mocked at the dep-injection layer; these stubs only prevent
// import-resolution errors — they are never actually called in e2e tests.

export const storage = {
	getItem: async (_key: string) => null,
	setItem: async (_key: string, _value: unknown) => {},
	removeItem: async (_key: string) => {},
	watch: (_key: string, _cb: unknown) => () => {},
	unwatch: () => {},
	clear: async () => {},
	snapshot: async () => ({}),
	restore: async (_snapshot: unknown) => {},
	define: (_key: string, _opts: unknown) => ({}),
	defineItem: (_key: string, _opts: unknown) => ({
		getValue: async () => null,
		setValue: async (_value: unknown) => {},
		removeValue: async () => {},
		watch: (_cb: unknown) => () => {},
	}),
};

export const browser = {};
