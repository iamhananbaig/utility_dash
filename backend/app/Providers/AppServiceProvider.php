<?php

namespace App\Providers;

use Illuminate\Foundation\DevCommands;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        $this->registerDevCommands();
    }

    /**
     * Processes started by `composer run dev` / `php artisan dev`: the whole stack in one terminal.
     */
    protected function registerDevCommands(): void
    {
        $root = dirname(base_path());

        // Both queues: FetchBillJob runs on "default", PDF jobs on "pdf".
        DevCommands::artisan('queue:listen --queue=default,pdf --timeout=0', 'queue');

        DevCommands::register(
            'cd '.escapeshellarg($root.'/python-api').' && CORS_ORIGINS=http://localhost:5173 uv run uvicorn main:app --reload --port 8001',
            'python',
        )->green();

        // The React app replaces the backend's own Vite (only used by the default welcome page).
        DevCommands::register('npm --prefix '.escapeshellarg($root.'/frontend').' run dev', 'vite')->blue();
    }
}
