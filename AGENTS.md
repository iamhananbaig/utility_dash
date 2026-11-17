# Utility Bills Dashboard

Multi-service app for managing utility bills (Pakistani providers). Four independent services, no monorepo tooling.

## Services

| Service | Stack | Entry | Port |
|---|---|---|---|
| `backend/` | Laravel 13, PHP 8.3, MySQL/Redis | `composer run dev` (starts all services) | 8000 |
| `frontend/` | React 19, Vite 8, Tailwind 4, TypeScript 6 | `npm run dev` (runs in `frontend/`) | 5173 |
| `python-api/` | FastAPI, Python 3.13, uv | `uv run uvicorn main:app --port 8001` | 8001 |
| `pdf-service/` | Node.js, Puppeteer | `node pdf-generator.js` | - |

## Key Commands

### Backend (run from `backend/`)
- `composer run setup` - first-time setup (install, key, migrate, npm, build)
- `composer run dev` - starts the whole stack: Laravel, queue listener (default+pdf), python-api, React frontend (registered in `AppServiceProvider::registerDevCommands`)
- `vendor/bin/pint --dirty --format agent` - format PHP after changes (mandatory)
- `php artisan test --compact` - run all tests
- `php artisan test --compact --filter=TestName` - run single test
- `php artisan make:test --pest SomeName` - create test (omit suite prefix)

### Frontend (run from `frontend/`)
- `npm run dev` - dev server with HMR
- `npm run build` - production build (tsc + vite)
- `npm run lint` - ESLint
- `npm run typecheck` - TypeScript check
- `npm run format` - Prettier

### Python API (run from `python-api/`)
- `uv run uvicorn main:app --reload` - dev server
- `uv run --extra test pytest` - run tests (pytest is in the optional `test` extra)

### Workers
- `./workers.sh start` - starts 5 default + 5 pdf queue workers (Redis)
- `./workers.sh stop|restart|status`

## Architecture Notes

- Frontend proxies `/samples` to backend at `localhost:8000` (Vite config).
- Backend queues jobs to Redis: `FetchBillJob` (default queue), `GenerateBillPdfJob` (pdf queue).
- `pdf-service/pdf-generator.js` is a standalone CLI tool called by the backend's pdf jobs. Requires Chrome in `~/.cache/puppeteer/`.
- `python-api/` handles bill scraping for providers (iesco, vcard). Backend calls it as an HTTP API.
- Backend uses MySQL + Redis (see `backend/.env.example`). Tests use in-memory SQLite via `phpunit.xml`; test files opt in with `uses(LazilyRefreshDatabase::class)` (global RefreshDatabase is commented out in `tests/Pest.php`).
- Redis `retry_after` (config/queue.php) must stay above the longest job `$timeout` (600s), or long jobs get run twice.
- Frontend data loading goes through `useQuery` (`src/hooks/use-query.ts`), user feedback through `notify` (`src/lib/notify.ts`) and `confirmDialog` (`src/lib/confirm.ts`), polling through `pollUntil`/`waitForBatch` (`src/lib/poll.ts`). Don't use `alert()`/`confirm()` or raw `fetch` in pages.
- Frontend uses `shadcn` (v4) components and `@tanstack/react-table`.
- Laravel Boost MCP server is configured in `backend/opencode.json` for DB queries, schema inspection, etc.

## Before Finalizing Changes

- PHP files: run `vendor/bin/pint --dirty --format agent` in `backend/`
- Frontend: run `npm run lint && npm run typecheck` in `frontend/`
- If Vite manifest error after backend changes: `npm run build` in `backend/`

## Deployment

See `DEPLOYMENT.md` for full dev and prod setup guides. Key facts:

- **Prod target**: `192.168.1.126:8002` (nginx + php-fpm + uv + systemd)
- **Dev**: `composer run dev` in `backend/` starts backend :8000, frontend :5173, python-api :8001 and a queue listener
- **Prod rebuild**: `VITE_API_URL=http://192.168.1.126:8002/api npm run build` in `frontend/`
- Services: `utility-backend`, `utility-python-api`, `utility-workers`, `nginx`
