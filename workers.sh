#!/bin/bash

# Worker manager for Utility Bills app
# Starts 5 workers for fetch queue and 5 workers for PDF queue

WORKERS_PER_QUEUE=5
LOG_DIR="/home/hanan/utility_dash/logs"
PID_DIR="/home/hanan/utility_dash/pids"

mkdir -p "$LOG_DIR" "$PID_DIR"

stop_workers() {
    echo "Stopping all workers..."
    for pidfile in "$PID_DIR"/*.pid; do
        [ -f "$pidfile" ] || continue
        pid=$(cat "$pidfile")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid"
            echo "  Stopped PID $pid"
        fi
        rm -f "$pidfile"
    done
    echo "All workers stopped."
}

start_workers() {
    echo "Starting $WORKERS_PER_QUEUE workers for 'default' queue..."
    for i in $(seq 1 $WORKERS_PER_QUEUE); do
        nohup php /home/hanan/utility_dash/backend/artisan queue:work redis \
            --queue=default \
            --sleep=3 \
            --tries=3 \
            --max-time=3600 \
            > "$LOG_DIR/worker-default-$i.log" 2>&1 &
        echo $! > "$PID_DIR/worker-default-$i.pid"
        echo "  Started default worker #$i (PID $!)"
    done

    echo "Starting $WORKERS_PER_QUEUE workers for 'pdf' queue..."
    for i in $(seq 1 $WORKERS_PER_QUEUE); do
        nohup php /home/hanan/utility_dash/backend/artisan queue:work redis \
            --queue=pdf \
            --sleep=3 \
            --tries=2 \
            --max-time=3600 \
            > "$LOG_DIR/worker-pdf-$i.log" 2>&1 &
        echo $! > "$PID_DIR/worker-pdf-$i.pid"
        echo "  Started pdf worker #$i (PID $!)"
    done

    echo ""
    echo "Started $((WORKERS_PER_QUEUE * 2)) workers total."
    echo "Logs: $LOG_DIR/"
    echo "PIDs: $PID_DIR/"
}

status_workers() {
    echo "Worker status:"
    echo "--- default queue ---"
    for i in $(seq 1 $WORKERS_PER_QUEUE); do
        pidfile="$PID_DIR/worker-default-$i.pid"
        if [ -f "$pidfile" ]; then
            pid=$(cat "$pidfile")
            if kill -0 "$pid" 2>/dev/null; then
                echo "  Worker #$i: RUNNING (PID $pid)"
            else
                echo "  Worker #$i: DEAD (stale PID $pid)"
            fi
        else
            echo "  Worker #$i: NOT STARTED"
        fi
    done
    echo "--- pdf queue ---"
    for i in $(seq 1 $WORKERS_PER_QUEUE); do
        pidfile="$PID_DIR/worker-pdf-$i.pid"
        if [ -f "$pidfile" ]; then
            pid=$(cat "$pidfile")
            if kill -0 "$pid" 2>/dev/null; then
                echo "  Worker #$i: RUNNING (PID $pid)"
            else
                echo "  Worker #$i: DEAD (stale PID $pid)"
            fi
        else
            echo "  Worker #$i: NOT STARTED"
        fi
    done
}

case "${1:-}" in
    start)
        start_workers
        ;;
    stop)
        stop_workers
        ;;
    restart)
        stop_workers
        sleep 2
        start_workers
        ;;
    status)
        status_workers
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac
