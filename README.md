# CLEARPATH

**Agentic vision for school safety assessment.** An OpenCV 5 pipeline analyses camera footage, an agent maintains a
threat-location belief over a school digital twin, decides which camera to look at next, re-processes footage when the
image quality is poor, separates *mathematical route validity* from *operational safety*, evaluates predefined response
procedures and **always pauses for human review**. Built for the OpenCV AI Competition 2026 (powered by AWS); targets
the Agentic Vision and Best Use of COOL awards.

> **SIMULATION ONLY.** Footage is synthetic (real pedestrians from OpenCV's public sample video, recomposited), triggers
> are simulated reports, and no code path can send a real alert, notification or door command.

![dashboard](docs/screenshots/02-awaiting-review-1600.png)

## What it does

| Layer | Implementation |
|---|---|
| Computer vision (OpenCV 5.0.0) | Image-quality assessment (brightness, contrast, Laplacian sharpness, dark-channel haze, frozen-feed and lens-obstruction checks) → optional CLAHE / dark-channel dehaze → MOG2 background subtraction → Farneback dense optical flow → **YOLOX-S via `cv.dnn`** (OpenCV Model Zoo, Apache-2.0) → multi-object tracking → speed in body-heights/s, running fraction, direction coherence. Two independent motion estimates (tracks vs flow) are cross-checked. |
| Agent | Explicit state machine with tool contracts (`vision.analyze_camera`, `twin.validate_building`, `decision.compute_routes`, `decision.assess_options`, human review). Vision output changes the next tool call: camera selection by expected information, dehaze re-run on haze, denser re-run on inconsistent motion, persistence check on weapon-like objects, fault + coverage gap on frozen/obstructed feeds, stop criteria, recommendation and review request. |
| Digital twin | Fictional single-storey school (16 zones, 6 exits, 17 doors, 7 cameras). Shapely validates geometry (overlaps, doors on shared walls, exits on the exterior, cameras inside zones); NetworkX validates connectivity, ≥2 exits per occupied space, configured travel distance, single points of failure. |
| Decision support | Bayesian threat-location belief (zones + "no threat"), likelihoods tempered by measured camera reliability, a floor on "no threat". Procedures follow the Standard Response Protocol vocabulary (Hold, Secure, Lockdown, Evacuate, Shelter + hybrid Lockdown/targeted Evacuate) with explicit preconditions. A report alone can never localise a threat or trigger evacuation. |
| UI | React + TypeScript + Vite + Tailwind + React Three Fiber. Camera player with detection overlays, interactive 2D/3D twin, belief, options, routes (math vs operational columns), human-review controls, live agent trace. Everything is backend state. |
| AWS | Separate Vision Service designed for Graviton (arm64) EC2; S3 for footage/run archives; CloudWatch metrics with `Arch`/`OpenCV`/`COOL` dimensions; least-privilege instance role; no Docker. Kit in `deploy/aws/`. |
| COOL | Swappable OpenCV build, verified at runtime by a build-info marker (`/v1/health` → `cool.state`) and a reproducible stock-vs-COOL benchmark harness (`backend/benchmarks/`). **No COOL numbers are claimed until measured on Graviton.** |

## Results (reproducible: `python backend/eval/run_eval.py`)

* Perception: **15/15** clips classified correctly (14 synthetic with generation ground truth + 1 unmodified real clip).
* Agent: **4/4** scenarios produce the expected recommendation; a naive "evacuate on any weapon report" rule scores **0/4**.
* Backend tests: **74 passed**; frontend tests: **18 passed**.

See [docs/EVALUATION_RESULTS.md](docs/EVALUATION_RESULTS.md) and [docs/TECHNICAL_REPORT.md](docs/TECHNICAL_REPORT.md).

## Run locally

Requirements: Python **3.12+**, Node 20+.

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python scripts/generate_footage.py                       # builds 14 synthetic clips (~30 s); downloads vtest.avi if missing
uvicorn clearpath.main:app --port 8000

# frontend (dev, hot reload; proxies /api and /media to :8000)
cd ../frontend
npm install
npm run dev                                              # http://localhost:5173
# or single-port: npm run build, then restart uvicorn and open http://localhost:8000
```

The YOLOX model (`backend/models/yolox_s_2022nov.onnx`, 36 MB) comes from the
[OpenCV Model Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/object_detection_yolox).

Run the vision service separately (as on AWS):

```bash
uvicorn clearpath.vision.service:app --port 8100
VISION_MODE=remote VISION_SERVICE_URL=http://127.0.0.1:8100 uvicorn clearpath.main:app --port 8000
```

Tests and evaluation:

```bash
cd backend && pytest -q && python eval/run_eval.py
cd frontend && npm test && npm run build
```

## Deploy on AWS Graviton

See [deploy/aws/README.md](deploy/aws/README.md). From WSL/Linux with AWS CLI v2 configured with an **IAM Identity
Center or IAM user profile (not root credentials)**:

```bash
cd deploy/aws && ./provision.sh --instance-type c7g.xlarge && ./verify.sh     # ./teardown.sh when done
```

## Scenarios

| ID | Visual input | Expected behaviour |
|---|---|---|
| S1 unverified report | normal walking everywhere | report not corroborated → **HOLD** + in-person verification |
| S2 corroborated east | people fleeing west in central/east cameras | localise east wing → **Lockdown east + evacuate west via verified routes** |
| S3 degraded sensing | lens obstructed, frozen feed, smoke | fault cameras, dehaze re-run, location unresolved → **building-wide LOCKDOWN** + verification tasks |
| S4 west threat, congested exit | fleeing east + crowd at East Exit | hybrid; east-wing routes **valid on paper but congested** → hold those rooms |

Use **Inputs** in the top bar to assign any clip (or your own uploaded video) to any camera and watch the outcome change.

## Repository layout

```
backend/clearpath/vision    OpenCV 5 pipeline, YOLOX detector, synthetic footage, vision service + client, runtime/COOL info
backend/clearpath/agent     perception → belief, orchestrator (agent loop, trace, review)
backend/clearpath/decision  routes + procedure assessment
backend/clearpath/twin      building model + validation
backend/benchmarks          stock vs COOL benchmark harness + results
backend/eval                end-to-end evaluation
frontend/                   dashboard
deploy/aws/                 Graviton EC2 deployment (systemd + nginx, no Docker)
docs/                       report, architecture + agent diagrams, evaluation, screenshots
```

## Responsible use

CLEARPATH is a decision-support research prototype. It does not detect firearms (the COCO model has no firearm class;
weapon-like COCO objects only trigger a persistence check and a human-verification task), it never acts on its own, and
it should never be connected to live alerting or door-control systems without professional safety review, policy
approval and validation on real data. Synthetic footage contains no real incident imagery.

## Credits / licences

OpenCV 5 (Apache-2.0); YOLOX-S ONNX from the OpenCV Model Zoo (Apache-2.0, `backend/models/YOLOX_LICENSE`);
`vtest.avi` from OpenCV's sample data. School layout and scenarios are fictional.
