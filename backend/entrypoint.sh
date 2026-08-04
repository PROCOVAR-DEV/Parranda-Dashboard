#!/bin/sh
set -e

echo "Running database seed (idempotent)..."
python -c "import app; app.seed_database()"

echo "Starting gunicorn (single worker, 32 threads)..."
# Cada conexion SSE abierta ocupa un hilo mientras dure, asi que los hilos ya no
# son solo para atender peticiones cortas: son tambien el limite de cuanta gente
# puede tener el panel abierto a la vez. Con 8 y cuatro personas mirando, la
# mitad del servidor se iba en esperar. 32 da margen de sobra y no cuesta nada:
# un hilo dormido en una condicion no consume CPU.
exec gunicorn -w 1 --threads 32 --timeout 120 --bind 0.0.0.0:5051 "app:create_app()"