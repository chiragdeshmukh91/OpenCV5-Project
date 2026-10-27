# Submission checklist

Checked on 2026-10-26. Official requirements come from the competition overview
(opencv.org/opencv-ai-competition-2026) and the Devpost pages (opencv26.devpost.com and /rules).

**Deadline:** the Devpost header says **26 Oct 2026, 11:45 pm PDT**. The overview text says 11:59 pm PT. Plan for
**11:45 pm PDT**, which is **27 Oct, 12:15 pm IST**.

Status: **Verified** (checked, with evidence), **Implemented** (exists, not checked in the stated environment),
**Action** (needs the team), **Blocked** (cannot be completed as things stand).

## A. Final submission package (official requirements)

| # | Requirement | Status | Evidence | Remaining action |
|---|---|---|---|---|
| A1 | Technical report: problem, users, architecture, OpenCV 5 implementation, AWS deployment, evaluation, limitations, responsible use | **Verified** (written from the code and the measured results) | `docs/technical-report.md` | Fill in the team name. Update §5 after redeploying. |
| A2 | Judge-accessible code repository or archive | **Action** | GitHub remote `chiragdeshmukh91/OpenCV5-Project`; the current changes are uncommitted | Commit and push (after your review). Then make the repo public, add judges as collaborators, or upload an archive. Confirm access from a logged-out browser. |
| A3 | Pinned dependencies plus build, deployment and test instructions | **Verified** | `backend/requirements*.txt` (exact pins), `frontend/package.json` + `package-lock.json` (exact pins, `npm ci`); `docs/setup.md`, `docs/deployment.md`, `docs/testing.md` | — |
| A4 | Architecture diagram showing OpenCV 5 and AWS (and agent/COOL where relevant) | **Verified** | `docs/architecture.mmd` → `architecture.png/.svg`; `docs/diagrams/agent_workflow.*` | — |
| A5 | Working web endpoint, or an arranged live screen-share | **Action** (not verified for the current code) | The old deployment `http://52.70.58.148` runs commit `a3e70d5`, which has the location bug. It was not reachable from this environment. | Redeploy (`deploy/aws/`), run `verify.sh`, and keep the instance up through judging (27 Oct – 9 Nov). Or arrange a screen-share with the organisers. |
| A6 | Public or unlisted video, **≤ 5 minutes**: team, working app, architecture, main results | **Implemented** (not yet uploaded) | `docs/video/clearpath-demo.mp4` (4:42: team intro, real app captures, architecture, results; synthetic narration) | Upload it public or unlisted, test the link logged out, add it to Devpost. |
| A7 | Evaluation evidence, including failure cases and limitations | **Verified** | `evaluation/README.md`, `evaluation/results/*.json`, `docs/EVALUATION_RESULTS.md`, `backend/eval/results/*.json` | — |
| A8 | OpenCV 5 as a substantive runtime component; image/video analysis central | **Verified** | OpenCV 5.0.0 pipeline in `backend/clearpath/vision/`; `/v1/health` reports the version | — |
| A9 | A meaningful AWS component | **Implemented** (current code not deployed) | `deploy/aws/`; the earlier deployment was reported verified on 2026-10-26 | Redeploy and run `verify.sh` (same action as A5). |
| A10 | Devpost submission form (description, links, team) | **Action** | Draft text: `docs/DEVPOST_SUBMISSION.md` | Fill in the form, add all team members, submit before the deadline. |
| A11 | Rights and consent for data and media | **Verified** | Only OpenCV sample footage, the YOLOX model (Apache-2.0, `backend/models/YOLOX_LICENSE`), and fictional layouts and scenarios | Confirm no other media goes into the video. |

## B. Agentic Vision award (additional evidence)

| # | Requirement | Status | Evidence |
|---|---|---|---|
| B1 | Agent workflow diagram (perception, decision/orchestration, action) | **Verified** | `docs/diagrams/agent_workflow.png` |
| B2 | Trace or demo showing OpenCV 5 output changing a later decision, tool call, or action | **Verified** | Run trace in the UI and in `/api/runs/<id>`: dehaze re-runs, fault → gap, belief changes, review gating. Tested in `test_agent_e2e.py`. |
| B3 | Evaluation of task success, failure handling, observability, human control | **Verified** | `evaluation/README.md` §5–6 (160/160 invariants, 4/4 recommendations); S3 fault/dehaze scenario |

## C. Best Use of COOL (not claimed)

| # | Requirement | Status | Note |
|---|---|---|---|
| C1 | COOL version and AWS deployment configuration | **Blocked** | COOL has not been run. A COOL-eligible Graviton instance and the Marketplace subscription are needed. |
| C2 | Reproducible evaluation against a baseline | **Implemented** harness, no results | `backend/benchmarks/` |
| C3 | Evidence that COOL runs the core workload | **Blocked** | `/v1/health` reports `cool.state = not_in_use` |

## D. AWS grant proposal

| # | Requirement | Status | Note |
|---|---|---|---|
| D1–D9 | Team name, problem and impact, OpenCV 5 analysis, AWS architecture and services, diagram, users, evaluation and demo plan, COOL/Agentic choice, team bios | **Action** (document complete apart from team fields) | `docs/aws-grant-proposal.md`. The official proposal window was August 2026, so this cannot now be submitted for credits. Fill in `[[...]]` fields if you keep it for the record. |

## E. Judge reproducibility

| Item | Status | Evidence / action |
|---|---|---|
| Fresh-clone local run | **Verified** on Linux (`setup.md` steps; footage regenerated with identical frames) | Windows `start.bat` was updated to also generate the footage and build the UI. **Action:** run it once on Windows. |
| Tests pass | **Verified** | backend 90, frontend 77, eval scripts (`docs/testing.md`) |
| No secrets in the repository | **Verified** | No keys in source. `deploy/aws/.state.env` is git-ignored. `.env.example` has no values for secrets. |
| No student identities or sensitive footage | **Verified** | Only OpenCV's public sample pedestrians |

## Outstanding before submission (in order)

1. Review the changes, then **commit and push** (they are not committed).
2. **Redeploy** to AWS, run `deploy/aws/verify.sh`, keep the instance running, and note the URL.
3. **Replace** the README hero screenshot. The old image shows the location bug.
4. **Record and upload** the ≤ 5-minute video.
5. **Fill in the team fields** (team name, members, bios) in the README, the technical report header and Devpost.
6. **Submit on Devpost** before 11:45 pm PDT, 26 Oct.
