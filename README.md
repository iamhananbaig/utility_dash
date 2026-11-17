# Utility Bills Dashboard

Web application for managing and tracking utility bills from Pakistani providers (IESCO, etc.). Automates bill fetching, payment tracking, and comparative analysis across properties.

## Tech Stack

| Service | Stack | Port |
|---|---|---|
| **Backend** | Laravel 13, PHP 8.3, MySQL, Redis | 8000 |
| **Frontend** | React 19, TypeScript 6, Vite 8, Tailwind 4, shadcn/ui | 5173 |
| **Python API** | FastAPI, Python 3.13, uv | 8001 |
| **PDF Service** | Node.js, Puppeteer | - |

## Prerequisites

- PHP 8.3+, Composer
- Node.js 20+, npm
- Python 3.13+, uv
- MySQL 8+
- Redis
- Chrome (for PDF generation via Puppeteer)

## Setup

### Backend

```bash
cd backend
cp .env.example .env   # then configure DB credentials
composer run setup      # installs deps, generates key, runs migrations, builds frontend assets
composer run dev        # starts the WHOLE stack (see below)
```

`composer run dev` (= `php artisan dev`) runs every dev process in one terminal:
Laravel on :8000, a queue listener for the `default` and `pdf` queues, the Python API
on :8001 and the React frontend on :5173. The sections below are only needed if you
want to run a service on its own.

### Frontend

```bash
cd frontend
npm install
npm run dev            # starts at localhost:5173
```

### Python API

```bash
cd python-api
uv sync --extra test
uv run uvicorn main:app --reload --port 8001
```

### Workers (background jobs, prod-style)

`composer run dev` already processes jobs. `workers.sh` is for long-running workers:

```bash
./workers.sh start     # starts 5 default + 5 pdf queue workers
./workers.sh status
./workers.sh stop
```

## Development

### Commands

| Task | Command |
|---|---|
| PHP formatting | `cd backend && vendor/bin/pint --dirty --format agent` |
| Frontend lint | `cd frontend && npm run lint` |
| Frontend typecheck | `cd frontend && npm run typecheck` |
| Frontend format | `cd frontend && npm run format` |
| Run backend tests | `cd backend && php artisan test --compact` |
| Run single test | `cd backend && php artisan test --compact --filter=TestName` |
| Build frontend assets | `cd frontend && npm run build` |
| Python tests | `cd python-api && uv run --extra test pytest` |

### Workflow

After PHP changes: `vendor/bin/pint --dirty --format agent` in `backend/`.
After frontend changes: `npm run lint && npm run typecheck` in `frontend/`.
If you see a Vite manifest error: `npm run build` in `backend/`.

## Architecture

- **Frontend** calls the backend API at `/api/*` (Vite proxies `/samples` to `localhost:8000`).
- **Backend** queues `FetchBillJob` and `GenerateBillPdfJob` to Redis.
- **Workers** (`workers.sh`) process the `default` and `pdf` queues via `queue:work redis`.
- **Python API** handles bill scraping from provider websites. Backend calls it as an HTTP service.
- **PDF Service** (`pdf-service/pdf-generator.js`) is a CLI tool invoked by the backend's PDF jobs. Requires Chrome in `~/.cache/puppeteer/`.

### Models

`Property` -> `Bill` (one-to-many), `Location` -> `Property` (one-to-many), `Bill` -> payment tracking.

## License

MIT
