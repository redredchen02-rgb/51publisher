.PHONY: test lint format build clean help

help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

test: ## Run all tests
	cd packages/backend && python3 -m pytest -v

test-quick: ## Run tests without verbose output
	cd packages/backend && python3 -m pytest -q

lint: ## Run linting checks
	cd packages/backend && ruff check scraper/ --select E,F,W --ignore E501

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
