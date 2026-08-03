#!/bin/sh
set -e

echo "Running database seed (idempotent)..."
python -c "import app; app.seed_database()"

echo "Starting gunicorn (single worker, threaded)..."
exec gunicorn -w 1 --threads 8 --timeout 120 --bind 0.0.0.0:5051 "app:create_app()"