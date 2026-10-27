@echo off
REM Start CLEARPATH locally on Windows (Python 3.12+ and Node 20+ on PATH).
REM First run: creates the venv, installs pinned packages, generates the synthetic footage and builds the UI.
cd /d "%~dp0backend"
if not exist .venv\Scripts\python.exe (
  python -m venv .venv || goto :error
  .venv\Scripts\python -m pip install -r requirements.txt || goto :error
)
if not exist footage\normal_a.avi (
  echo Generating synthetic footage from assets\vtest.avi ^(about 30 s^)...
  .venv\Scripts\python scripts\generate_footage.py || goto :error
)
if not exist ..\frontend\dist\index.html (
  echo Building the web UI...
  pushd ..\frontend
  call npm ci || goto :error
  call npm run build || goto :error
  popd
)
start "" http://localhost:8000
.venv\Scripts\python -m uvicorn clearpath.main:app --port 8000
goto :eof
:error
echo Setup failed - see the message above and docs\setup.md
exit /b 1
