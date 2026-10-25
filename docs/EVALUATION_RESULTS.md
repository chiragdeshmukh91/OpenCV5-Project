# CLEARPATH evaluation results

Generated 2026-10-25 08:40:49 Asia on `x86_64` with OpenCV 5.0.0 (vision mode: local).
All footage is synthetic (recomposited OpenCV sample video) and all triggers are simulated. Numbers below are produced by `backend/eval/run_eval.py` and are reproducible.

## Perception (OpenCV 5) vs generation ground truth

Activity classification: **15/15** clips correct.

| Clip | Expected | Observed | After dehaze | People (true / median / max) | Speed BH/s | Coherence | Reliability | Issues | ms |
|---|---|---|---|---|---|---|---|---|---|
| congested_exit | congested | congested | — | 14 / 13 / 14 | 0.1 | 0.14 | 1.00 | — | 5411 |
| empty_a | empty | empty | — | 0 / 0 / 0 | — | 0.00 | 1.00 | — | 5127 |
| empty_b | empty | empty | — | 0 / 0 / 0 | — | 0.00 | 1.00 | — | 4810 |
| flight_left_a | flight | flight | — | 9 / 6 / 9 | 2.83 | 0.93 | 1.00 | — | 4956 |
| flight_left_b | flight | flight | — | 7 / 4 / 7 | 2.71 | 0.97 | 1.00 | — | 5034 |
| flight_right_a | flight | flight | — | 9 / 4 / 9 | 3.53 | 0.99 | 1.00 | — | 4300 |
| flight_right_b | flight | flight | — | 8 / 6 / 8 | 2.76 | 0.86 | 1.00 | — | 4407 |
| frozen_normal | unusable | unusable | — | 6 / 5 / 5 | 0.06 | 0.22 | 0.10 | frozen_feed | 4789 |
| normal_a | calm | calm | — | 6 / 6 / 6 | 0.71 | 0.32 | 1.00 | — | 5154 |
| normal_b | calm | calm | — | 5 / 5 / 5 | 0.74 | 0.20 | 1.00 | — | 4257 |
| normal_c | calm | calm | — | 7 / 6 / 7 | 1.0 | 0.24 | 1.00 | — | 5210 |
| normal_d | calm | calm | — | 4 / 3 / 4 | 0.85 | 0.60 | 1.00 | — | 4369 |
| smoke_normal | calm | calm | calm | 7 / 6 / 7 | 0.91 | 0.25 | 0.55 | low_visibility_haze | 4275 |
| tampered | unusable | unusable | — | 5 / 0 / 5 | 1.07 | 0.25 | 0.05 | frozen_feed, lens_obstructed_or_defocused | 4727 |
| REAL vtest.avi (unmodified) | calm | calm | — | n/a / 4 / 6 | 0.56 | 0.65 | 1.00 | — | 6730 |

## Agent (end-to-end, until human review)

Recommendation matches expectation: **4/4** scenarios. Naive baseline ("evacuate on any weapon report"): **0/4**.

| Scenario | Expected | Agent | Naive baseline | P(threat) | Region (correct?) | Cameras used / 7 | Re-analyses | Faults → gaps | Steps | Wall s |
|---|---|---|---|---|---|---|---|---|---|---|
| S1-unverified-report | HOLD | HOLD | EVACUATE | 0.09 | n/a (not localised) | 3 | 0 | 0 → — | 19 | 16.2 |
| S2-corroborated-east | LOCKDOWN_PLUS_EVACUATE | LOCKDOWN_PLUS_EVACUATE | EVACUATE | 0.93 | C3, R107, R103 (yes) | 6 | 0 | 0 → — | 27 | 29.4 |
| S3-degraded-sensing | LOCKDOWN | LOCKDOWN | EVACUATE | 0.17 | n/a (not localised) | 7 | 1 | 2 → CAM-04, CAM-02 | 33 | 42.4 |
| S4-west-threat-congested-exit | LOCKDOWN_PLUS_EVACUATE | LOCKDOWN_PLUS_EVACUATE | EVACUATE | 0.95 | C1, R104, R101 (yes) | 7 | 0 | 0 → — | 33 | 34.9 |

Every run paused for human review before any (simulated) action: yes.

## Limitations

- Footage is synthetic; sprites are real pedestrians but motion is composited, so this measures the pipeline and the agent logic, not field accuracy.
- The detector is COCO YOLOX; it has no firearm class. CLEARPATH never claims a firearm detection; weapon-like COCO classes only trigger a persistence check and a human-verification task.
- Activity thresholds (running ≥ 2 body-heights/s, coherence ≥ 0.6) were set on these clips and need validation on real footage.
- Likelihood ratios in the belief update are hand-set, documented constants, not learned from data.
