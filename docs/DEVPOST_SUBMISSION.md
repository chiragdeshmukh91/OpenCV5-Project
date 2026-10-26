# Devpost submission draft — CLEARPATH

**Tagline:** An agent that looks before it leaps: OpenCV 5 evidence, a school digital twin and a human in the loop for active-threat response decisions.

## Inspiration
In an active-threat report, the first information is often wrong, cameras are many and partly broken, and an evacuation order can send students toward danger. We wanted a system that refuses to "detect a gun → evacuate", and instead gathers evidence, says what it does not know, and lets a person decide.

## What it does
CLEARPATH receives a simulated report, then an agent decides which camera to analyse with OpenCV 5, re-processes footage when quality is poor, marks broken feeds as coverage gaps, localises the probable threat region on a digital twin, checks evacuation routes for both mathematical validity and operational safety, evaluates Standard-Response-Protocol procedures and pauses for human review. Every tool call, reason and state change is visible in a live trace.

## How we built it
OpenCV 5.0.0 (quality metrics, CLAHE/dehaze, MOG2, Farneback, `cv.dnn` YOLOX-S, tracking) · FastAPI · NetworkX + Shapely · React/TypeScript/Vite/Tailwind/React Three Fiber · AWS Graviton EC2 `t4g.small` (arm64, systemd + nginx, no Docker), S3, CloudWatch, IAM instance role, SSM Session Manager, CloudShell for provisioning · COOL-ready benchmark harness (not measured).

**Try it:** http://52.70.58.148 · Graviton proof: http://52.70.58.148/v1/health

## Results
15/15 perception checks (incl. real footage) · 4/4 scenarios vs 0/4 for a naive evacuate-on-report rule · 74 + 51 automated tests · every run paused for human review · live on AWS Graviton with all deployment checks passing (aarch64 proof, CloudWatch `VisionTotalMs` ≈ 10.2 s per clip, run archives in S3).

## Challenges
Getting honest test data (solved by recompositing real pedestrian sprites with OpenCV so ground truth is known), and separating "a route exists" from "a route is safe".

## What's next
Validation on real consented footage, multi-floor DXF import, multi-threat belief, HTTPS via CloudFront, a larger Graviton instance and measured COOL gains.

## Video script (≤ 5 min)
1. 0:00–0:30 Team + problem; "simulation only" disclaimer.
2. 0:30–1:15 Architecture diagram: Vision Service on Graviton, API, S3, CloudWatch, COOL swap point.
3. 1:15–2:30 S2 live: trace shows camera choice → flight detected (overlays) → belief localises east wing → corroboration → corridor checks → hybrid recommendation → approve (SIMULATED log).
4. 2:30–3:30 S3: frozen + obstructed feeds become gaps, smoke triggers dehaze re-run, agent declines to localise → building-wide lockdown + verification tasks.
5. 3:30–4:10 S4: route valid on paper but congested — math vs operational columns; report exit blocked → routes recompute.
6. 4:10–4:40 AWS proof: `/v1/health` aarch64 + instance type, CloudWatch `VisionTotalMs` with `Arch=aarch64`, S3 run archive, `verify.sh` ALL CHECKS PASSED.
7. 4:40–5:00 Evaluation table, limitations, responsible use.
