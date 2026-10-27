# Devpost submission draft — CLEARPATH

**Tagline:** An agent that looks before it leaps: OpenCV 5 evidence, a school digital twin and a human in the loop for active-threat response decisions.

## Inspiration
In an active-threat report, the first information is often wrong, cameras are many and partly broken, and an evacuation order can send students toward danger. We wanted a system that refuses to "detect a gun → evacuate", and instead gathers evidence, says what it does not know, and lets a person decide.

## What it does
CLEARPATH receives a simulated report, then an agent decides which camera to analyse with OpenCV 5, re-processes footage when quality is poor, marks broken feeds as coverage gaps, localises the probable threat region on a digital twin, checks evacuation routes for both mathematical validity and operational safety, evaluates Standard-Response-Protocol procedures and pauses for human review. Every tool call, reason and state change is visible in a live trace.

## How we built it
OpenCV 5.0.0 (quality metrics, CLAHE/dehaze, MOG2, Farneback, `cv.dnn` YOLOX-S, tracking) · FastAPI · NetworkX + Shapely · React/TypeScript/Vite/Tailwind/React Three Fiber · AWS Graviton EC2 `t4g.small` (arm64, systemd + nginx, no Docker), S3, CloudWatch, IAM instance role, SSM Session Manager, CloudShell for provisioning · COOL-ready benchmark harness (not measured).

**Try it:** `[[URL after redeploy + verify.sh]]` · Graviton proof: `<URL>/v1/health` · Video: `[[unlisted video URL]]` · Code: `[[repo URL]]`

## Results
On synthetic composites (details in `evaluation/README.md`): 15/15 activity labels · person detection P 0.970 / R 0.932 (optimistic: sprites cut with the same detector) · 0/10 false candidate events · 0/26 observations placed in a zone before human review · 160/160 review-state invariants · 4/4 scenarios after review vs 0/4 for a naive evacuate-on-report rule · 90 + 77 automated tests. Not measured: real-footage accuracy, firearm detection (not supported), Graviton latency for the current code, COOL.

## Challenges
Getting honest test data (solved by recompositing real pedestrian sprites with OpenCV so ground truth is known), and separating "a route exists" from "a route is safe".

## What's next
Validation on real consented footage, multi-floor DXF import, multi-threat belief, HTTPS via CloudFront, a larger Graviton instance and measured COOL gains.

## Video script
See `docs/demo-video-script.md`.
