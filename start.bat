@echo off
rem Starts the backend (:8000) and the frontend dev server (:5180) in two windows.
rem First run also creates the Python venv, installs dependencies, and creates backend\.env.
setlocal
set "ROOT=%~dp0"

where python >nul 2>nul || (echo Python 3 is not on PATH. Install it from python.org and re-run. & pause & exit /b 1)
where npm >nul 2>nul || (echo Node.js/npm is not on PATH. Install it from nodejs.org and re-run. & pause & exit /b 1)

rem --- Backend setup ---
cd /d "%ROOT%backend" || exit /b 1
if not exist ".venv\Scripts\python.exe" (
    echo Creating Python virtual environment...
    python -m venv .venv || (echo venv creation failed. & pause & exit /b 1)
)
echo Installing backend dependencies...
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt || (echo pip install failed. & pause & exit /b 1)
if not exist ".env" (
    copy ".env.example" ".env" >nul
    echo Created backend\.env from .env.example.
    echo Set ICA_API_KEY in backend\.env to enable resume summaries. Search and org chart work without it.
)

rem --- Frontend setup ---
cd /d "%ROOT%frontend" || exit /b 1
if not exist "node_modules" (
    echo Installing frontend dependencies...
    call npm install || (echo npm install failed. & pause & exit /b 1)
)

rem --- Launch ---
rem No --reload: it is flaky on Windows and serves stale routes.
start "Backend :8000" /d "%ROOT%backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --port 8000"
start "Frontend :5180" /d "%ROOT%frontend" cmd /k "npm run dev"

echo Waiting for the servers to come up...
timeout /t 6 /nobreak >nul
start "" "http://localhost:5180"
echo Running. Close the Backend and Frontend windows to stop.
endlocal
