# Deployment Guide

Dev and prod setup for Utility Bills Dashboard on Ubuntu.

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| PHP | 8.3+ | Backend (Laravel 13) |
| Node.js | 20+ | Frontend build + PDF service |
| Python | 3.13+ | Python API (uv manages this automatically) |
| MySQL | 8+ | Database |
| Redis | 7+ | Queue, cache, sessions |
| Chrome/Chromium | — | PDF generation via Puppeteer |

### PHP Extensions (required)

```
bcmath curl gd mbstring pdo_mysql redis xml zip
```

### System Packages

```bash
sudo apt update && sudo apt install -y \
  php8.3 php8.3-fpm php8.3-mysql php8.3-redis php8.3-xml \
  php8.3-mbstring php8.3-curl php8.3-zip php8.3-bcmath php8.3-gd \
  mysql-server redis-server nginx curl unzip
```

---

## Dev Setup

Run everything locally with hot-reload.

### 1. Backend (Laravel)

```bash
cd backend
composer run setup    # installs deps, generates key, migrates, builds frontend
composer run dev      # http://localhost:8000
```

If `composer run setup` fails on the npm step, run frontend setup separately:

```bash
cd frontend && npm install && npm run build
```

### 2. Frontend (React/Vite)

```bash
cd frontend
npm install
npm run dev           # http://localhost:5173
```

The Vite dev server proxies `/samples` to the backend at `localhost:8000`.

### 3. Python API (FastAPI)

```bash
cd python-api
uv sync                           # installs deps + Python 3.13 if needed
uv run uvicorn main:app --reload --port 8001
```

### 4. Workers (Redis Queue)

```bash
./workers.sh start    # starts 5 default + 5 pdf workers
./workers.sh status   # check worker health
./workers.sh stop     # stop all workers
```

Workers require Redis running on `localhost:6379`.

### 5. PDF Service

No server needed. It's a CLI tool called by workers.

Requires Chrome for Puppeteer:

```bash
cd pdf-service
npm install
PUPPETEER_CACHE_DIR=~/.cache/puppeteer npx puppeteer browsers install chrome
```

### Dev Environment Variables

Backend `.env` (already exists):

```
APP_ENV=local
APP_DEBUG=true
APP_URL=http://localhost:8000
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_DATABASE=utilities
DB_USERNAME=hanan
DB_PASSWORD=123
QUEUE_CONNECTION=redis
PYTHON_API_URL=http://127.0.0.1:8001
```

Python API (inline env):

```bash
CORS_ORIGINS=http://localhost:5173 uv run uvicorn main:app --reload --port 8001
```

---

## Prod Setup — 192.168.1.126:8002

### 1. Install System Packages

```bash
sudo apt update && sudo apt install -y \
  php8.3-fpm php8.3-mysql php8.3-redis php8.3-xml \
  php8.3-mbstring php8.3-curl php8.3-zip php8.3-bcmath php8.3-gd \
  nginx
```

### 2. Create Production `.env`

```bash
cat > /home/hanan/utility_dash/backend/.env.production << 'EOF'
APP_NAME="Utility Bills"
APP_ENV=production
APP_KEY=base64:ENRc2ApOU0CwO8MtMSHjTK18Y6pvTxEMVxiZCUzakLQ=
APP_DEBUG=false
APP_URL=http://192.168.1.126:8002

APP_LOCALE=en
APP_FALLBACK_LOCALE=en
APP_FAKER_LOCALE=en_US

APP_MAINTENANCE_DRIVER=file

BCRYPT_ROUNDS=12

LOG_CHANNEL=stack
LOG_STACK=single
LOG_LEVEL=warning

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=utilities
DB_USERNAME=hanan
DB_PASSWORD=123

SESSION_DRIVER=database
SESSION_LIFETIME=120
SESSION_ENCRYPT=false
SESSION_PATH=/
SESSION_DOMAIN=null

BROADCAST_CONNECTION=log
FILESYSTEM_DISK=local
QUEUE_CONNECTION=redis

CACHE_STORE=redis

REDIS_CLIENT=phpredis
REDIS_HOST=127.0.0.1
REDIS_PASSWORD=null
REDIS_PORT=6379

MAIL_MAILER=log

PYTHON_API_URL=http://127.0.0.1:8001
FRONTEND_URL=http://192.168.1.126:8002
EOF
```

### 3. Cache Laravel Config

```bash
cd /home/hanan/utility_dash/backend
cp .env.production .env
php artisan key:generate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan migrate --force
```

### 4. Build Frontend for Production

```bash
cd /home/hanan/utility_dash/frontend
VITE_API_URL=http://192.168.1.126:8002/api npm run build
```

### 5. Configure Nginx

```bash
sudo tee /etc/nginx/sites-available/utility-dash << 'EOF'
server {
    listen 8002;
    server_name 192.168.1.126 _;

    root /home/hanan/utility_dash/frontend/dist;
    index index.html;

    client_max_body_size 50M;

    # Frontend SPA — serve static files, fallback to index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API — proxy to Laravel backend
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    # Sample file downloads
    location /samples/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
    }

    # Laravel health check
    location /up {
        proxy_pass http://127.0.0.1:8000;
    }

    # Deny access to hidden files
    location ~ /\. {
        deny all;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/utility-dash /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 6. Create Systemd Services

#### Backend (Laravel)

```bash
sudo tee /etc/systemd/system/utility-backend.service << 'EOF'
[Unit]
Description=Utility Bills Laravel Backend
After=network.target mysql.service redis.service

[Service]
Type=simple
User=hanan
Group=hanan
WorkingDirectory=/home/hanan/utility_dash/backend
ExecStart=/home/hanan/.config/herd-lite/bin/php artisan serve --host=127.0.0.1 --port=8000
Restart=always
RestartSec=5
Environment=APP_ENV=production
Environment=APP_DEBUG=false

[Install]
WantedBy=multi-user.target
EOF
```

#### Python API (FastAPI)

```bash
sudo tee /etc/systemd/system/utility-python-api.service << 'EOF'
[Unit]
Description=Utility Bills Python API
After=network.target

[Service]
Type=simple
User=hanan
Group=hanan
WorkingDirectory=/home/hanan/utility_dash/python-api
ExecStart=/home/hanan/.local/bin/uv run uvicorn main:app --host 127.0.0.1 --port 8001
Restart=always
RestartSec=5
Environment=CORS_ORIGINS=http://192.168.1.126:8002

[Install]
WantedBy=multi-user.target
EOF
```

#### Queue Workers

```bash
sudo tee /etc/systemd/system/utility-workers.service << 'EOF'
[Unit]
Description=Utility Bills Queue Workers
After=network.target redis.service mysql.service

[Service]
Type=simple
User=hanan
Group=hanan
WorkingDirectory=/home/hanan/utility_dash/backend
ExecStart=/home/hanan/.config/herd-lite/bin/php artisan queue:work redis --queue=default,pdf --sleep=3 --tries=3 --max-time=3600
Restart=always
RestartSec=10
Environment=APP_ENV=production
Environment=APP_DEBUG=false

[Install]
WantedBy=multi-user.target
EOF
```

### 7. Enable and Start Services

```bash
sudo systemctl daemon-reload

sudo systemctl enable --now nginx
sudo systemctl enable --now utility-backend
sudo systemctl enable --now utility-python-api
sudo systemctl enable --now utility-workers
```

### 8. Verify

```bash
# Check all services
sudo systemctl status nginx utility-backend utility-python-api utility-workers

# Test endpoints
curl -s http://192.168.1.126:8002 | head -5        # Frontend
curl -s http://192.168.1.126:8002/api/dashboard     # API
curl -s http://127.0.0.1:8000/up                    # Laravel health
curl -s http://127.0.0.1:8001/                      # Python API health
```

---

## Service Management

### Quick Reference

| Action | Command |
|---|---|
| Restart backend | `sudo systemctl restart utility-backend` |
| Restart Python API | `sudo systemctl restart utility-python-api` |
| Restart workers | `sudo systemctl restart utility-workers` |
| Restart nginx | `sudo systemctl restart nginx` |
| Restart all | `sudo systemctl restart utility-backend utility-python-api utility-workers nginx` |

### Logs

```bash
# Live logs
journalctl -u utility-backend -f
journalctl -u utility-python-api -f
journalctl -u utility-workers -f

# Last 100 lines
journalctl -u utility-backend -n 100
journalctl -u utility-workers -n 100

# Since a time
journalctl -u utility-backend --since "1 hour ago"
```

### Rebuild Frontend After Changes

```bash
cd /home/hanan/utility_dash/frontend
VITE_API_URL=http://192.168.1.126:8002/api npm run build
sudo systemctl restart nginx
```

### Run Migrations After Updates

```bash
cd /home/hanan/utility_dash/backend
php artisan migrate --force
php artisan config:cache
php artisan route:cache
```

### Worker Management (Prod)

Workers are managed by systemd now. If you need manual control:

```bash
# Stop systemd workers first
sudo systemctl stop utility-workers

# Manual control
cd /home/hanan/utility_dash/backend
php artisan queue:work redis --queue=default,pdf

# Or use the script (dev only)
./workers.sh start
./workers.sh status
./workers.sh stop
```

---

## Troubleshooting

### 502 Bad Gateway (nginx)

Backend isn't running:

```bash
sudo systemctl status utility-backend
sudo journalctl -u utility-backend -n 50
```

Fix:

```bash
sudo systemctl restart utility-backend
```

### API Returns CORS Errors

Check `FRONTEND_URL` in backend `.env.production`:

```bash
grep FRONTEND_URL /home/hanan/utility_dash/backend/.env.production
# Should be: http://192.168.1.126:8002
```

Also check `CORS_ORIGINS` in python-api service:

```bash
sudo systemctl show utility-python-api -p Environment
```

### Python API Won't Start

```bash
sudo journalctl -u utility-python-api -n 50
```

Common fixes:

```bash
# Reinstall Python deps
cd /home/hanan/utility_dash/python-api
uv sync

# Check Python version
uv python list
```

### Workers Stuck / Not Processing

```bash
# Check Redis
redis-cli ping

# Check failed jobs
cd /home/hanan/utility_dash/backend
php artisan queue:failed

# Retry failed jobs
php artisan queue:retry all

# Restart workers
sudo systemctl restart utility-workers
```

### PDF Generation Fails

Check Chrome is installed:

```bash
ls ~/.cache/puppeteer/
/home/hanan/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome
```

Install if missing:

```bash
cd /home/hanan/utility_dash/pdf-service
PUPPETEER_CACHE_DIR=~/.cache/puppeteer npx puppeteer browsers install chrome
```

### Permission Issues

```bash
sudo chown -R hanan:hanan /home/hanan/utility_dash/backend/storage
sudo chown -R hanan:hanan /home/hanan/utility_dash/backend/bootstrap/cache
chmod -R 775 /home/hanan/utility_dash/backend/storage
chmod -R 775 /home/hanan/utility_dash/backend/bootstrap/cache
```

### Vite Manifest Error After Backend Changes

```bash
cd /home/hanan/utility_dash/backend
npm run build
```

---

## Port Summary

| Port | Service | Access |
|---|---|---|
| 8002 | Nginx (frontend + API proxy) | Public |
| 8000 | Laravel backend | Internal only |
| 8001 | Python API | Internal only |
| 3306 | MySQL | Internal only |
| 6379 | Redis | Internal only |
| 5173 | Vite dev server | Dev only |
