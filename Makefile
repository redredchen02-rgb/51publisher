.PHONY: test test-quick test-backend test-extension lint lint-extension format build build-extension build-backend clean stats scrape-all help

help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

test: test-backend test-extension ## Run all tests (backend + extension)

test-backend: ## Run backend Python tests
	cd packages/backend && python3 -m pytest -v

test-extension: ## Run extension unit tests (needs: npm install in packages/extension)
	cd packages/extension && npm test

test-quick: ## Run backend tests without verbose output
	cd packages/backend && python3 -m pytest -q

lint: lint-python lint-extension ## Run all linting checks

lint-python: ## Lint backend Python with ruff
	cd packages/backend && ruff check scraper/ --select E,F,W --ignore E501

lint-extension: ## Lint extension JS with eslint (needs: npm install in packages/extension)
	cd packages/extension && npm run lint

format: ## Format Python code with ruff
	cd packages/backend && ruff format scraper/

build: ## Build all artifacts
	npm run build

build-extension: ## Build extension only
	npm run build:extension

build-backend: ## Build backend only
	npm run build:backend

clean: ## Clean build artifacts
	npm run clean

stats: ## Show database statistics
	cd packages/backend && python3 -m scraper stats

scrape-all: ## Run full scrape
	cd packages/backend && python3 -m scraper scrape --all
