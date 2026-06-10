.PHONY: setup dev test format clean

setup:
	pnpm install

dev:
	pnpm --filter publisher-backend dev & pnpm --filter publisher-fill-assistant dev

test:
	pnpm -r test

format:
	pnpm run format

clean:
	rm -rf node_modules packages/extension/.wxt packages/extension/.output packages/extension/node_modules packages/backend/dist packages/backend/node_modules
