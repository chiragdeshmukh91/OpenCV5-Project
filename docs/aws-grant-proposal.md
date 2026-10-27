# AWS Compute Grant Proposal: CLEARPATH

OpenCV AI Competition 2026 (powered by AWS)

> **Timing.** The official schedule (opencv.org/opencv-ai-competition-2026) opened grant proposals on 12 Aug 2026,
> began a rolling review on 18 Aug, and sent recipient notices from 25 Aug. This document follows the nine required
> sections. It is ready to file or archive, but it **can no longer be submitted for a credit award in 2026** unless the
> organisers say otherwise.
>
> Fields in `[[double brackets]]` need the team's input. Nothing in them has been invented.
>
> Status labels: **Implemented** = in the repository and tested locally; **Reported** = stated by the team, not
> re-verified; **Planned** = not built yet.

## 1. Team

* **Team name:** `[[TEAM NAME]]`
* **Representative (submits and receives notices):** `[[NAME, EMAIL]]`
* **Members:** see §9.

## 2. Problem statement and intended impact

When an active threat is reported at a school, the people deciding the response have to act on a first report that is
often wrong or imprecise, many partly broken camera feeds, and floor plans that show where routes *exist* but not
whether they are *safe*. A system that evacuates on "weapon detected" can send students toward danger.

CLEARPATH is a **decision-support and training simulator**. An agent:

* treats the report as weak evidence;
* chooses which cameras to analyse with OpenCV 5;
* re-processes poor footage;
* refuses to place an observation in the building unless its location is verified or confirmed by a person;
* separates "route is valid on the plan" from "route was verified safe by a recent, reliable camera";
* recommends a Standard Response Protocol procedure with its uncertainty, and always waits for a human decision.

**Intended impact:**

* Better-rehearsed, evidence-based response decisions.
* Explicit coverage gaps, such as frozen or obstructed cameras, that a district can fix before an incident.
* A transparent alternative to "detect and auto-alert" systems.

## 3. Target users and beneficiaries

* **Users:** school safety leads, school resource officers, and district emergency planners, in training and
  tabletop exercises.
* **Beneficiaries:** students and staff, through better-prepared responders and audited camera coverage.
* **Researchers:** human-in-the-loop vision agents with full traces.

**Not intended for:** autonomous real-time alerting, identification of individuals, or any use without trained
human review.

## 4. OpenCV 5 image and video analysis

**Implemented** in `backend/clearpath/vision/pipeline.py`. Each 40-frame clip goes through these stages:

* `VideoCapture` decode.
* Image quality:
  * brightness and contrast;
  * Laplacian sharpness;
  * dark-channel haze;
  * frozen-feed detection with `absdiff`;
  * lens obstruction.

  Together these give a **reliability** score that weights how much the evidence counts.
* On-demand dark-channel dehaze and CLAHE.
* MOG2 background subtraction.
* Farneback dense optical flow.
* YOLOX-S through `cv.dnn` (OpenCV Model Zoo) with `NMSBoxesBatched`.
* Tracking with speeds in body-heights per second, running flags, a key frame, and evidence frames at native
  resolution.

The analysis results change the agent's next action:

* haze → dehaze re-run;
* tracking and flow disagree → denser re-analysis;
* weapon-like COCO object → persistence check and a human verification task;
* frozen or obstructed feed → camera fault and a coverage gap;
* flight direction → shifts the threat-location belief.

There is **no firearm detection**: COCO has no firearm class, and none is claimed.

## 5. AWS architecture and services

The deployment scripts in `deploy/aws/` are **Implemented**. A deployment of an earlier commit was **Reported** on
2026-10-26, on `t4g.small` at `52.70.58.148`. The current code has not been redeployed.

| Service | Use |
|---|---|
| Amazon EC2, Graviton (arm64), Ubuntu 24.04 | The OpenCV vision service and the agent API run as systemd services behind nginx. |
| Amazon S3 (private, SSE-S3) | Application bundle, footage, archived run traces (`runs/<id>.json`) |
| Amazon CloudWatch | Custom metrics `VisionTotalMs`, `DetectMs` and `FlowMs`, with `Arch`, `OpenCV` and `COOL` dimensions |
| AWS IAM + IMDSv2 | Least-privilege instance role. No keys on disk. |
| AWS Systems Manager Session Manager | Administration without SSH or open port 22 |
| COOL on AWS Marketplace | **Planned:** a stock-vs-COOL comparison on the same Graviton instance (harness implemented, not run) |
| CloudFront or ALB with ACM | **Planned:** HTTPS for the judge endpoint |

**Compute requirement:** about 7 s of CPU per camera clip on 2 x86 vCPUs, measured. The team reported about 10.2 s on
`t4g.small`. A scenario analyses 7 cameras. A judge demo needs one 2–4 vCPU Graviton instance. A COOL benchmark needs a
COOL-eligible Graviton instance family for a few hours.

## 6. High-level technical architecture

See `docs/architecture.mmd` (rendered as `docs/architecture.png`) and `docs/diagrams/agent_workflow.png`. In short:

Browser UI
→ nginx
→ API (agent orchestrator → location gate → Bayesian belief → digital twin with NetworkX/Shapely → decision engine
→ human review)
→ HTTP
→ Vision Service (OpenCV 5)
→ S3 and CloudWatch.

## 7. Budget and justification

The official credit is **$150 per selected participant**. The plan below is an estimate built from on-demand
us-east-1 prices.

| Item | Basis | Estimated cost |
|---|---|---|
| Judge demo instance, `t4g.small`, 24/7 for the judging window (27 Oct – 9 Nov, 14 days) | $0.0168/h × 336 h | ≈ $5.65 |
| Development and test runs, `t4g.small`, about 200 h | $0.0168/h | ≈ $3.40 |
| COOL vs stock benchmark on a COOL-eligible Graviton instance (e.g. c7g.xlarge), about 20 h | ≈ $0.145/h (repo estimate, re-check) | ≈ $2.90, plus any COOL Marketplace software fee `[[CHECK LISTING PRICE]]` |
| EBS gp3 20 GiB, 2 instances, 2 months | about $1.60 per month per volume | ≈ $6.40 |
| S3 storage and requests; CloudWatch custom metrics | small volumes | ≈ $5 |
| HTTPS front end (CloudFront), data transfer | low traffic | ≈ $5 |
| Contingency | | ≈ $20 |
| **Total requested** | | **`[[GRANT AMOUNT]]`** (the estimate above is about $50, within the $150 credit) |

Every resource carries the tag `Project=CLEARPATH`. `teardown.sh` removes everything after judging.

## 8. Evaluation method and judge demonstration

**Evaluation** (`evaluation/README.md`; scripts are in the repository and results are reported as measured):

* Person detection precision and recall against generator ground truth.
* Running-track classification.
* Clip-level false-alert rate.
* Location-attribution consistency (no zone before verification).
* 160 human-review state invariants.
* Recommendation accuracy before and after review, against a naive baseline.
* Per-clip latency.
* Pending until measured: real-footage accuracy, physical location accuracy, Graviton latency for the current
  commit, and COOL speed-up.

**Judge demonstration:**

1. Open the endpoint, or a live screen-share.
2. Run scenario S2.
3. Watch the agent choose cameras and re-process footage in the trace.
4. Open the evidence review: key frame, running tracks, and "location unknown".
5. Confirm or dismiss the observations and watch the recommendation change.
6. Approve; the action log shows SIMULATED entries only.
7. Show `/v1/health` (`aarch64`), the CloudWatch metrics and the S3 run archive.

## 9. Path: Agentic Vision. Not COOL (for now).

**Agentic Vision: pursued.** The official criteria are: OpenCV 5 tools in a multi-step perception-decision-action
loop, where image or video results change a later plan, tool call, action, or request for human approval. CLEARPATH
meets these, as follows:

* Vision output selects the next camera, triggers re-analysis with different OpenCV parameters, marks faults, moves the
  belief, and gates human-review requests.
* Every step is traced, with the tool, arguments, result and reason.
* Failure handling (faults, dehaze, contradictory evidence) and human control (confirm, dismiss, approve, reject) are
  implemented and tested.

**COOL: not pursued for the award, unless it can be measured.**

* The COOL criteria require verified COOL running the core workload on Graviton, with measured results against a
  baseline.
* The build swap point, runtime verification and a strict benchmark harness exist. COOL itself has not been run.
* We will claim COOL only after the protocol in `backend/benchmarks/README.md` has produced a same-instance
  comparison.

## 10. Team bios

All of these must be completed by the team. None has been invented.

| Member | Role | Relevant experience | Hackathons / competitions |
|---|---|---|---|
| `[[Name 1]]` | `[[role]]` | `[[experience]]` | `[[participation, or "first competition"]]` |
| `[[Name 2]]` | | | |
| `[[Name 3]]` | | | |

> Draft for one member, from details Rohit has shared. Confirm or edit before use:
> *"Rohit: civil and geospatial engineer working on software development, GIS/LiDAR processing and
> engineering-drawing automation, including C++ processing pipelines and CAD tooling. On CLEARPATH: `[[role]]`."*
