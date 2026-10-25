@echo off
REM Start CLEARPATH (first run creates the venv and installs packages)
cd /d "%~dp0backend"
if not exist .venv\Scripts\python.exe (
  python -m venv .venv
  .venv\Scripts\python -m pip install -r requirements.txt
)
start "" http://localhost:8000
.venv\Scripts\python -m uvicorn clearpath.main:app --port 8000 --reload --reload-dir clearpath
