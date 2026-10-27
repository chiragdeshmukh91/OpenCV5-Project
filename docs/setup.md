# Local setup

CLEARPATH runs as one process locally: a FastAPI API with OpenCV in-process, serving the built React UI. No AWS
account is needed.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Python | **3.12 or 3.13** (tested on 3.13) | `numpy==2.5.3` and `opencv-python-headless==5.0.0.93` need a recent CPython |
| Node.js | 20 or later (tested on 22) | only needed to build the UI |
| Disk | about 1 GB | venv, `node_modules`, 34 MB of generated footage |
| OS | Linux, macOS or Windows | Windows: use `start.bat` or the PowerShell commands below |

Dependencies are pinned:

* backend: exact versions in `backend/requirements.txt`, plus `requirements-vision.txt` for a standalone vision
  service;
* frontend: exact versions in `frontend/package.json`, locked by `frontend/package-lock.json` (`npm ci`).

The YOLOX model (`backend/models/yolox_s_2022nov.onnx`, from the OpenCV Model Zoo, Apache-2.0) and the OpenCV sample
`backend/assets/vtest.avi` are committed.

## Quick start (Windows)

```bat
start.bat
```

On its first run, the script sets everything up before starting the app:

1. Creates `backend\.venv` and installs the pinned packages.
2. Generates the synthetic footage.
3. Builds the UI.

It then starts the server and opens http://localhost:8000.

## Step by step (Linux / macOS; Windows equivalents in comments)

```bash
# 1. backend
cd backend
python3 -m venv .venv && source .venv/bin/activate         # Windows: python -m venv .venv ; .venv\Scripts\activate
pip install -r requirements.txt
python scripts/generate_footage.py                          # REQUIRED: 14 clips + ground truth into backend/footage (~30 s)

# 2. frontend
cd ../frontend
npm ci
npm run build                                               # -> frontend/dist, served by the API

# 3. run
cd ../backend
uvicorn clearpath.main:app --port 8000                      # open http://localhost:8000
```

`generate_footage.py` is required because the generated `.avi` clips are **not committed** (`.gitignore`). If they
are missing, the backend logs a startup warning that names the fix, and preview and analysis requests return a 404
with the same hint.

### Development mode (hot reload)

```bash
cd backend && uvicorn clearpath.main:app --port 8000 --reload --reload-dir clearpath
cd frontend && npm run dev                                  # http://localhost:5173, proxies /api and /media to :8000
```

### Separate vision service (as on AWS)

```bash
cd backend
uvicorn clearpath.vision.service:app --port 8100
VISION_MODE=remote VISION_SERVICE_URL=http://127.0.0.1:8100 uvicorn clearpath.main:app --port 8000
```

## Configuration

All configuration is through environment variables, and every one is optional. They are documented in
`backend/.env.example`, which the app does not load by itself.

Useful variables:

* `AGENT_STEP_DELAY_S=0`: faster runs, for example during a demo.
* `CLEARPATH_SKIP_IMDS=1`: skips the EC2 metadata probes when you are not on AWS.

## Using the app

1. The app always opens on **Start**. Pick a scenario and press **Start analysis**. It takes about 1 minute.
2. When the agent pauses, open **Review evidence**. You can also reach it from the Evidence page or the camera panel.
3. Inspect each observation on its key frame. Running tracks are red. The location is "unknown" until you confirm it.
4. **Confirm** or **Dismiss** each observation, then **Approve** or **Reject** the recommended procedure. Every
   decision appears in the timeline and the trace.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `GET /api/footage/<clip>/preview.jpg 404` | Run `python scripts/generate_footage.py` in `backend/` |
| UI shows "Backend unreachable" | Start uvicorn on port 8000. The UI retries automatically. |
| `ModuleNotFoundError: cv2` | Activate the venv. Install exactly one OpenCV distribution (`opencv-python-headless`). |
| Slow analyses | Expected on 2 vCPU (about 7 s per camera). Set `DNN_THREADS` to your core count. |
