# AWS Compute Grant Proposal: CLEARPATH
**OpenCV AI Competition 2026 — AWS Compute Grant**

> **Review status:** Draft for team review. Verify all placeholders and current deployment details before submission. Implemented features and reported test results are distinguished from planned work; AWS deployment of the current code has not been verified.

## 1. Team

- **Team name:** [ChillB4TheKill]
- **Project:** CLEARPATH
- **Team representative / contact:** [Chirag Deshmukh] · [chiragdeshmukh1001@gmail.com]
- **Team members:**
  - **Chirag Deshmukh — Technical Lead.** Leads project management, algorithm and system design, and the integration of computer vision and agentic workflows. Profile highlights computational geometry, computer vision, image processing, generative/agentic AI, AWS, Azure, and Python.
  - **Sanika Satpute — Fullstack Developer.** Contributes to application development across the frontend and backend, including React, TypeScript, Node.js, Python, SQL, computer vision/AI-ML integration, and project implementation.
  - **Vinod Kudale — DevOps Engineer.** Focuses on deployment and automation, with skills including Docker, Kubernetes, AWS, Azure, Terraform, Jenkins, Ansible, GitHub, and Azure DevOps.

*Confirm each member’s exact responsibilities, the team name, representative, and contact email before submission. The role descriptions above are based on the supplied team profile graphics; do not add unverified awards or experience.*

## 2. Executive summary

CLEARPATH is a school-safety simulation and decision-support prototype that combines OpenCV 5 video analysis, an agentic evidence-review workflow, and a 3D campus digital twin. It is designed to help authorized school-safety personnel examine uncertain reports, assess camera evidence and coverage limitations, understand affected zones, and review route options before approving a simulated response.

CLEARPATH is intentionally human-in-the-loop. A report alone does not establish the location of a threat, uncertain or unverified footage must not automatically create a threat zone, and consequential actions remain subject to human review. The current application is a simulation; it does not send real emergency alerts or control physical doors.

The requested compute would support repeatable evaluation, processing of multiple camera streams or scenario clips, and measurement of performance on an AWS Graviton/ARM64 environment. The present implementation has been tested locally on x86_64 Linux; the current code has not been verified as deployed on AWS.

## 3. Problem statement and intended impact

During a developing school incident, initial reports may be incomplete or inaccurate. Camera feeds can be dark, hazy, frozen, obstructed, or associated with an incorrect location. A route that exists geometrically may still be unsafe operationally. A workflow that reacts to a single unverified report or detection can therefore produce misleading recommendations.

CLEARPATH addresses this coordination gap by bringing video-derived observations, camera reliability, location confidence, route constraints, and reviewer decisions into one auditable workflow.

**Intended users and beneficiaries**
- Authorized school safety staff and school administrators conducting scenario review or preparedness exercises.
- District safety teams and emergency-planning personnel evaluating monitoring and response procedures.
- Researchers and developers studying evidence-aware, human-reviewed computer-vision workflows.

CLEARPATH is not intended to identify people, independently determine that a campus is safe, replace trained responders, or make autonomous real-world emergency decisions.

## 4. OpenCV 5 image and video analysis

The implemented vision service uses FastAPI and OpenCV 5.0.0. The documented pipeline includes:

- Video-frame decoding and image-quality checks, including brightness/contrast, sharpness, haze, frozen-frame, and tampering indicators.
- Image enhancement using CLAHE and dark-channel dehazing where applicable.
- MOG2 background subtraction and Farneback optical flow for motion evidence.
- YOLOX-S through `cv.dnn` for person/object candidate detection and tracking-related evidence.
- Structured observations and evidence frames passed to the agent workflow, including running-person tracks and a selected key frame.

The configured COCO model does **not** include a firearm class. CLEARPATH does not claim to detect guns. Camera location is assigned only when footage is registered to the camera or a human confirms the location; otherwise, the location remains unknown and awaits review.

The current evaluation uses re-composited pedestrian sprites derived from the public OpenCV `vtest.avi` sample, with frame-level ground truth for the synthetic composites. Detection scores from this setup are optimistic because the sprites were cut using the same detector. The evaluation is useful for software-path and scenario checks, but it is not evidence of real-school accuracy.

## 5. Agentic workflow, digital twin, and human review

The decision engine follows an explicit perceive → validate → decide → review workflow. It records tool calls, arguments, results, and reasoning traces. Evidence reliability tempers Bayesian belief updates; low-reliability or frozen/obstructed footage has little influence. A report by itself does not localize a threat, and the model retains a minimum probability for the no-threat hypothesis.

The fictional-campus digital twin represents zones, doors, exits, and cameras. NetworkX and Shapely support route and geometry checks. Route existence is not treated as proof of route safety. Reviewers can confirm or dismiss candidate observations with reasons, and response approval is explicit. Action logs are marked `SIMULATED`.

A regression test addresses a previous location-attribution failure in which outdoor footage replayed on an indoor camera could have mapped people into an indoor threat zone. Unverified footage must now remain unlocalized until confirmation.

## 6. AWS architecture and services

### Proposed deployment approach

The existing deployment scripts describe a small AWS Graviton/ARM64 EC2 instance running the application services under `systemd`, with Nginx as a reverse proxy. The proposal is to use the simplest architecture that can support the prototype and then scale only when measured workload requires it.

| Service / component | Purpose | Status |
|---|---|---|
| Amazon EC2, Graviton/ARM64 | Run the FastAPI application and OpenCV/agent services | Proposed; current code not deployed |
| Nginx + systemd | Reverse proxy and service management | Deployment approach documented |
| Amazon S3 (private) | Store permitted scenario assets, run archives, and evaluation artifacts | Planned |
| Amazon CloudWatch | Application logs, metrics, and error monitoring | Planned |
| AWS IAM role + IMDSv2 | Least-privilege instance access without long-lived credentials | Planned/configuration target |
| AWS Systems Manager Session Manager | Administrative access without opening SSH to the public internet | Planned |
| HTTPS via a suitable certificate and endpoint configuration | Secure judge access | Planned; endpoint not verified |
| COOL-compatible Graviton benchmarking | Measure throughput and cost/performance on eligible ARM64 compute | Planned; no measured COOL result claimed |

For a prototype, video processing and agent orchestration can run on the same Graviton instance initially, avoiding the operational overhead of multiple services. If processing load or reliability requirements grow, the vision service can be separated from the web/API tier. S3 should remain private, access should be scoped by IAM, and logs should avoid storing unnecessary sensitive footage or personal data.

### Data flow

1. A user starts a fictional or test scenario in the web application.
2. The API/agent workflow requests analysis from the OpenCV 5 vision service.
3. The vision service returns quality indicators, motion/person observations, and evidence frames.
4. The agent validates camera registration, location confidence, evidence reliability, and route constraints.
5. The digital twin displays the resulting state and recommendation.
6. A human reviewer confirms or dismisses observations and explicitly approves or rejects the simulated response.
7. Application logs and evaluation artifacts support traceability and repeatable testing.

**Deployment status:** The supplied validation notes state that AWS verification was not run for the current code. No public endpoint, successful AWS health check, or deployed revision is claimed here.

## 7. Compute request and budget assumptions

The grant would be used to validate the application on AWS Graviton/ARM64, run scenario evaluations, collect repeatable latency/throughput/resource measurements, and demonstrate the workflow to judges. The final requested compute size and duration should be selected after confirming the grant’s current eligible instance families and credit rules.

Budget estimates must be recalculated using the selected AWS region, instance family and size, storage volume, data transfer, logging, and actual run hours. Stop or terminate resources after testing. No grant amount, available credit, or final AWS cost is asserted in this draft.

## 8. Evaluation plan and current evidence

The repository’s testing notes report the following local results from a full run on **2026-10-26** using x86_64 Linux, Python 3.13, Node 22, and OpenCV 5.0.0:

- Backend: **90 passed**, with one Starlette/httpx test-client deprecation warning.
- Frontend: **77 passed** across 8 files; TypeScript type-check passed.
- Production frontend build completed, with a Three.js chunk-size warning.
- `pip check`: no broken requirements found.
- `pip-audit -r requirements.txt`: no known vulnerabilities found in the checked pinned packages.
- `npm audit --omit=dev`: 0 runtime dependency vulnerabilities reported.
- `run_eval.py`: reported perception 15/15; agent before review 4/4 report-only LOCKDOWN; after confirmation 4/4 expected; naive baseline 0/4.
- Review consistency: **160/160** invariant checks passed.
- Local scenario logic in `verify.sh`: passed; the ARM64 check is expected to fail on the x86_64 local machine.
- AWS deployment verification for the current code: **not run**.

The project will use the following AWS evaluation plan:
1. Run the same test suite on the selected Graviton instance and record the exact instance type, region, code revision, and dependency versions.
2. Measure end-to-end scenario latency, frames processed per second, CPU and memory utilization, and restart/failure recovery.
3. Repeat the evaluation scenarios and record precision/recall only where ground-truth labels are meaningful, with the synthetic-data caveat clearly stated.
4. Measure compute hours and associated cost using actual billing/usage data.
5. Publish the commands, raw outputs, scenario definitions, and failure cases with the technical report.

These local results are not claims of real-world school validation or of measured COOL performance.

## 9. COOL / Agentic Vision path

CLEARPATH uses OpenCV 5 and an explicit agent workflow, but those facts alone do not establish eligibility for either competition path. The team should verify the competition’s current official definitions and eligibility rules before selecting a path.

The most directly relevant planned experiment is a reproducible Graviton/ARM64 benchmark for the COOL path. Agentic Vision should be selected only if the official criteria match the project’s actual vision-agent behavior and the implementation meets those criteria. Do not claim either path as completed or eligible until that verification is documented.

## 10. Responsible use, security, and limitations

- The current product is a simulation and decision-support prototype; actions are marked `SIMULATED`.
- Human review is required before consequential recommendations are approved.
- Unknown camera location must remain unknown until verified.
- The current model does not detect firearms.
- Synthetic recomposited footage does not establish performance in real school environments.
- No real-school deployment or operational validation is claimed.
- Before any real-world pilot, the team would need authorized and privacy-reviewed data, security review, authentication and HTTPS for review actions, camera calibration/registration, a validated detection model for any additional target class, and a formal human-led safety evaluation.
- AWS resources should use least-privilege IAM, private storage, secure administration, monitored logs, and a documented teardown process.

## 11. Team experience and short bios

- **Chirag Deshmukh — Technical Lead:** Project management, algorithm and system design, computational geometry, computer vision, image processing, agentic/generative AI, cloud platforms, and Python, based on the supplied profile graphic.
- **Sanika Satpute — Fullstack Developer:** Fullstack application development using React, TypeScript, Node.js, Python, SQL, and integration of AI/ML and computer-vision functionality, based on the supplied profile graphic and team role.
- **Vinod Kudale — DevOps Engineer:** Deployment and automation focus across Docker, Kubernetes, AWS, Azure, Terraform, Jenkins, Ansible, GitHub, and Azure DevOps, based on the supplied profile graphic.

**Before submission, add verified prior hackathon/competition experience and achievements for each member if desired.** The provided profile graphics do not establish specific awards or past competition results, so none are invented here.

## 12. Pre-submission checklist

- [ ] Confirm team name.
- [ ] Confirm representative name and contact email.
- [ ] Confirm each member’s role and contribution wording.
- [ ] Verify official AWS grant rules, eligible compute, funding/credit terms, and deadline.
- [ ] Select COOL, Agentic Vision, both, or neither based on official eligibility criteria.
- [ ] Run tests on the target Graviton instance and preserve logs.
- [ ] Record measured AWS performance and actual costs.
- [ ] Deploy and verify a judge-accessible endpoint, or arrange a screen-share demo.
- [ ] Remove all placeholders and re-check every implementation/deployment claim.
