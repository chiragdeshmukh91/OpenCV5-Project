# CLEARPATH evaluation results

Generated 2026-10-26 14:11:49 Asia on `x86_64` with OpenCV 5.0.0 (vision mode: local).
All footage is synthetic (recomposited OpenCV sample video) and all triggers are simulated. Numbers below are produced by `backend/eval/run_eval.py` and are reproducible.

## Perception (OpenCV 5) vs generation ground truth

Activity classification: **15/15** clips correct.

| Clip | Expected | Observed | After dehaze | People (true / median / max) | Speed BH/s | Coherence | Reliability | Issues | ms |
|---|---|---|---|---|---|---|---|---|---|
| congested_exit | congested | congested | — | 14 / 13 / 14 | 0.1 | 0.14 | 1.00 | — | 6097 |
| empty_a | empty | empty | — | 0 / 0 / 0 | — | 0.00 | 1.00 | — | 6124 |
| empty_b | empty | empty | — | 0 / 0 / 0 | — | 0.00 | 1.00 | — | 5902 |
| flight_left_a | flight | flight | — | 9 / 6 / 9 | 2.83 | 0.93 | 1.00 | — | 6447 |
| flight_left_b | flight | flight | — | 7 / 4 / 7 | 2.71 | 0.97 | 1.00 | — | 6663 |
| flight_right_a | flight | flight | — | 9 / 4 / 9 | 3.53 | 0.99 | 1.00 | — | 6570 |
| flight_right_b | flight | flight | — | 8 / 6 / 8 | 2.76 | 0.86 | 1.00 | — | 6591 |
| frozen_normal | unusable | unusable | — | 6 / 5 / 5 | 0.06 | 0.22 | 0.10 | frozen_feed | 6222 |
| normal_a | calm | calm | — | 6 / 6 / 6 | 0.71 | 0.32 | 1.00 | — | 6104 |
| normal_b | calm | calm | — | 5 / 5 / 5 | 0.74 | 0.20 | 1.00 | — | 5550 |
| normal_c | calm | calm | — | 7 / 6 / 7 | 1.0 | 0.24 | 1.00 | — | 5875 |
| normal_d | calm | calm | — | 4 / 3 / 4 | 0.85 | 0.60 | 1.00 | — | 6534 |
| smoke_normal | calm | calm | calm | 7 / 6 / 7 | 0.91 | 0.25 | 0.55 | low_visibility_haze | 6243 |
| tampered | unusable | unusable | — | 5 / 0 / 5 | 1.07 | 0.25 | 0.05 | frozen_feed, lens_obstructed_or_defocused | 7600 |
| REAL vtest.avi (unmodified) | calm | calm | — | n/a / 4 / 6 | 0.56 | 0.65 | 1.00 | — | 9513 |

## Agent (end-to-end, with human review of observation locations)

The footage is replayed sample video (an outdoor plaza), not recorded by the school's cameras, so the agent does not use a camera's mount zone as the observation's location. Before review, no observation moves the threat map (**4/4** runs unlocalised; first recommendation matches the report-prior expectation in **4/4**). After a reviewer confirms the observations' locations:

Recommendation matches expectation: **4/4** scenarios. Naive baseline ("evacuate on any weapon report"): **0/4**.

| Scenario | Before review | Expected (after) | Agent (after) | Naive baseline | P(threat) | Region (correct?) | Cameras used / 7 | Re-analyses | Faults → gaps | Steps | Wall s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S1-unverified-report | LOCKDOWN | HOLD | HOLD | EVACUATE | 0.04 | n/a (not localised) | 7 | 0 | 0 → — | 57 | 49.6 |
| S2-corroborated-east | LOCKDOWN | LOCKDOWN_PLUS_EVACUATE | LOCKDOWN_PLUS_EVACUATE | EVACUATE | 0.97 | C3, R107, R103 (yes) | 7 | 0 | 0 → — | 55 | 45.4 |
| S3-degraded-sensing | LOCKDOWN | LOCKDOWN | LOCKDOWN | EVACUATE | 0.17 | n/a (not localised) | 7 | 1 | 2 → CAM-04, CAM-02 | 56 | 59.0 |
| S4-west-threat-congested-exit | LOCKDOWN | LOCKDOWN_PLUS_EVACUATE | LOCKDOWN_PLUS_EVACUATE | EVACUATE | 0.95 | C1, R104, R101 (yes) | 7 | 0 | 0 → — | 57 | 47.8 |

Every run paused for human review before any (simulated) action: yes.

## Limitations

- Footage is synthetic; sprites are real pedestrians but motion is composited, so this measures the pipeline and the agent logic, not field accuracy.
- Observation locations are confirmed by a human in this evaluation; no camera calibration or site-registered footage exists, so location accuracy is not measured.
- The detector is COCO YOLOX; it has no firearm class. CLEARPATH never claims a firearm detection; weapon-like COCO classes only trigger a persistence check and a human-verification task.
- Activity thresholds (running ≥ 2 body-heights/s, coherence ≥ 0.6) were set on these clips and need validation on real footage.
- Likelihood ratios in the belief update are hand-set, documented constants, not learned from data.
