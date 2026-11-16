@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul || (echo [ERROR] Node.js not found & pause & exit /b 1)
where uv   >nul 2>nul || (echo [ERROR] uv not found & pause & exit /b 1)

echo [1/5] Frontend deps...
call npm install --no-fund --no-audit || goto :fail

echo [2/5] Backend deps...
cd server
uv sync || goto :fail
if not exist .env copy .env.example .env >nul

echo [3/5] Migrations + demo data...
uv run alembic upgrade head || goto :fail
uv run python -m app.seed || goto :fail

echo [4/5] Frontend build...
cd ..
call npm run build || goto :fail

echo [5/5] Server: http://127.0.0.1:8001  (Ctrl+C or close window to stop)
cd server
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:8001"
uv run fastapi run app/main.py --port 8001
goto :eof

:fail
echo.
echo FAILED. Read the error above.
pause
exit /b 1