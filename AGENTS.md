# Utility Bills Dashboard

Multi-service app for managing utility bills (Pakistani providers). Four independent services, no monorepo tooling.

## Services

| Service | Stack | Entry | Port |
|---|---|---|---|
| `backend/` | Laravel 13, PHP 8.3, SQLite/Redis | `php artisan serve` or `composer run dev` | 8000 |
| `frontend/` | React 19, Vite 8, Tailwind 4, TypeScript 6 | `npm run dev` (runs in `frontend/`) | 5173 |
| `python-api/` | FastAPI, Python 3.13, uv | `uv run uvicorn main:app --port 8000` | 8000 |
| `pdf-service/` | Node.js, Puppeteer | `node pdf-generator.js` | - |

## Key Commands

### Backend (run from `backend/`)
- `composer run setup` - first-time setup (install, key, migrate, npm, build)
- `composer run dev` - starts artisan dev server
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
- `uv run pytest` - run tests

### Workers
- `./workers.sh start` - starts 5 default + 5 pdf queue workers (Redis)
- `./workers.sh stop|restart|status`

## Architecture Notes

- Frontend proxies `/samples` to backend at `localhost:8000` (Vite config).
- Backend queues jobs to Redis: `FetchBillJob` (default queue), `GenerateBillPdfJob` (pdf queue).
- `pdf-service/pdf-generator.js` is a standalone CLI tool called by the backend's pdf jobs. Requires Chrome in `~/.cache/puppeteer/`.
- `python-api/` handles bill scraping for providers (iesco, vcard). Backend calls it as an HTTP API.
- Backend uses SQLite by default (see `backend/.env.example`). Tests use in-memory SQLite.
- Frontend uses `@shadcn/react` components and `@tanstack/react-table`.

## Before Finalizing Changes

- PHP files: run `vendor/bin/pint --dirty --format agent` in `backend/`
- Frontend: run `npm run lint && npm run typecheck` in `frontend/`
- If Vite manifest error after backend changes: `npm run build` in `backend/`
