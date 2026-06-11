# TODOS

## Backend / Infrastructure

- **Fix backend test dependencies in CI** | **Priority:** P0
  packages/backend/dist/ 下 8 个测试文件因缺失依赖（fastify、better-sqlite3、@51publisher/shared）而持续失败。
  这些包在 extension 的 node_modules 中未安装，需要为后端单独配置测试环境或将依赖移到工作区根目录。
  失败文件: auth-routes.test.js, batch-routes.test.js, config-routes.test.js, cors.test.js, llm.test.js,
  scraper/fact-extractor.test.js, scraper/pending-store.test.js, scraper/scraper-routes.test.js
  发现于: feat/phase-2-measurement (2026-06-11)

## Completed
