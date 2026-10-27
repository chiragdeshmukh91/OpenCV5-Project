# Testing and validation

Last full run: **2026-10-26**, on x86_64 Linux (2 vCPU Xeon 2.8 GHz), Python 3.13, Node 22, OpenCV 5.0.0. Each
result below is the actual output of the command beside it.

## Commands

```bash
# backend (venv active, footage generated: python scripts/generate_footage.py)
cd backend
pytest -q                                   # unit + API + real-OpenCV + end-to-end agent tests
pip check                                   # dependency consistency
pip install pip-audit && pip-audit -r requirements.txt   # known vulnerabilities in pinned packages

# frontend
cd frontend
npm ci
npx tsc --noEmit -p .                       # type check
npx vitest run                              # unit + component tests (jsdom)
npm run build                               # production build -> dist/
npm audit --omit=dev                        # runtime dependency vulnerabilities

# evaluation (repository root, backend venv active)
python backend/eval/run_eval.py
python evaluation/run_detection_eval.py
python evaluation/run_review_consistency.py

# deployment check (only against a deployed instance)
deploy/aws/verify.sh http://<public-ip>
```

## Results (2026-10-26)

| Check | Result |
|---|---|
| `pytest -q` | **90 passed**, 1 warning (Starlette deprecation of `httpx` in its test client), about 100 s |
| `pip check` | No broken requirements found |
| `pip-audit -r requirements.txt` | No known vulnerabilities found |
| `tsc --noEmit` | no errors |
| `vitest run` | **77 passed** (8 files) |
| `npm run build` | built. The three.js chunk is over 500 kB (warning only). |
| `npm audit --omit=dev` | 0 vulnerabilities. Vulnerable runtime/dev versions (drei→uuid, vite 5.4.10, vitest 2.1.4, postcss 8.4.47) were moved to patched versions in the same major. |
| `npm audit` (including dev tools) | 10 remaining findings (7 moderate, 1 high, 2 critical). All are in build/test tooling: vite dev server, vitest, tailwind/postcss-selector-parser. Fixing them needs major upgrades (vite 8, vitest 5, tailwind 4), which were not done before the deadline. None is shipped in `frontend/dist` or used in production, which is served by FastAPI. |
| `run_eval.py` | perception 15/15. Agent: before review 4/4 report-only LOCKDOWN; after confirmation 4/4 expected; naive baseline 0/4 |
| `run_detection_eval.py` | see `evaluation/README.md` |
| `run_review_consistency.py` | **160/160** invariant checks |
| `verify.sh` §2 (scenario logic) against a local server | PASS: first recommendation LOCKDOWN with 7 pending observations; after confirmation LOCKDOWN_PLUS_EVACUATE; approval SIMULATED. The aarch64 check fails locally, as expected (x86). |
| `verify.sh` against AWS | **Not run for the current code** (not deployed) |

## What the tests cover

| Area | Tests |
|---|---|
| OpenCV pipeline on real (recomposited) footage | `test_vision.py`: activity, motion statistics, haze/frozen/tamper flags, enhancement, the YOLOX decode on `vtest.avi`, native-resolution evidence frames, running tracks and the key frame, the "no firearm class" guarantee |
| Belief and decision | `test_belief.py`, `test_decision.py`: tempered updates, the report-only prior, preconditions, a rejected option never silently re-proposed (`no_feasible_alternative`) |
| Digital twin | `test_twin.py`: geometry and connectivity validation |
| Location attribution (bug regression) | `test_location.py`; `test_agent_e2e.py::test_unverified_footage_never_raises_zone_alerts` (4 scenarios), `::test_verified_footage_is_applied_automatically`; `frontend/src/__tests__/observations.test.ts` |
| Human review | `test_agent_e2e.py`: confirm/dismiss (reason required, evidence kept, 409 on repeat), approve, reject, block exit; `EvidenceReview.test.tsx`: payloads sent, consequences shown, no fake success on a backend error |
| API | `test_api.py`: status, footage, previews, missing-footage hint, 404/409 paths, vision service auth, COOL marker states |
| Start / workflow | `observations.test.ts › startup`; `EvidenceReview.test.tsx › StartPage`: always opens on Start, explicit resume, start success and failure, unreachable backend |
| Evidence drawing | `evidence.test.ts`: running vs person vs weapon-like styling, trails, DNN-frame navigation, aspect-preserving fit |

## Manual validation procedure (about 5 minutes)

1. `start.bat`, or the steps in `setup.md`. The browser opens on **Start**. A refresh always returns there.
2. Choose **S2 – corroborated incident** and press **Start analysis**. Within about 1 minute the status becomes
   "Awaiting decision".
   * Expected: incident location "Unknown (report: C3)", **no** red threat zone, and the recommendation LOCKDOWN.
3. Click **Review evidence · 7 pending**, then select **CAM-03**.
   * Expected: the full-size frame opens on its KEY FRAME, with red `#id RUN x.x BH/s` boxes.
   * The location reads "Unknown (camera mounted in C3)" with the reasons listed.
   * The Firearm field reads "No firearm detector is configured…".
4. Press **Confirm**.
   * Expected: the chip becomes "Alert · human-confirmed".
   * The recommendation becomes LOCKDOWN → EVACUATE.
   * The timeline and trace show the decision under your reviewer name.
5. Select another candidate event. **Dismiss** it with a reason.
   * Expected: the chip becomes "Dismissed by reviewer", and its footage is still viewable.
6. Close the review. On Operations, the twin shows "Threat zone · camera evidence" and flight arrows only for the
   confirmed cameras.
7. Press **Approve**. The action log contains only `SIMULATED …` lines.
