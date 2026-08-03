@echo off
REM Procovar - Parranda: start backend (5051) and frontend (5175)
cd /d "%~dp0"

start "Parranda Backend" cmd /k "cd backend && venv\Scripts\python.exe app.py"
start "Parranda Frontend" cmd /k "cd frontend && npm run dev"

timeout /t 5 /nobreak >nul
start http://localhost:5175
