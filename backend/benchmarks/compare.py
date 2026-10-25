#!/usr/bin/env python3
"""Compare two bench_opencv.py result files and print a markdown table of speedups (baseline / candidate).

    python benchmarks/compare.py results/stock-graviton-...json results/cool-graviton-...json

Refuses (exit 2) when the two runs are not comparable - different CPU architecture, EC2 instance type or CPU
model - unless --force is given, in which case the table is printed under a prominent warning. Also flags runs
where both files used the identical OpenCV build (then it is not a stock-vs-COOL comparison) and a candidate
labelled "cool" whose COOL marker was not verified in the loaded build.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def load(p: Path) -> dict:
    d = json.loads(p.read_text())
    if not str(d.get("schema", "")).startswith("clearpath-opencv-bench/"):
        raise SystemExit(f"{p}: not a clearpath benchmark result")
    return d


def cpu_name(ident: dict) -> str | None:
    c = ident.get("cpu") or {}
    return c.get("model_name") or c.get("arm_core") or c.get("arm_part")


def itype(ident: dict) -> str | None:
    return (ident.get("ec2") or {}).get("instance_type")


def rows(base: dict, cand: dict) -> list[tuple[str, str, float, float]]:
    out = []
    for section in ("micro", "dnn"):
        for k, v in base.get(section, {}).items():
            if k in cand.get(section, {}):
                out.append((section, k, v["median_ms"], cand[section][k]["median_ms"]))
    for k, v in base.get("e2e", {}).items():
        if k in cand.get("e2e", {}):
            out.append(("e2e", f"analyze_video[{k}]", v["median_ms"], cand["e2e"][k]["median_ms"]))
            for st, ms in v["stage_timings_ms_median_run"].items():
                cms = cand["e2e"][k]["stage_timings_ms_median_run"].get(st)
                if st != "total_ms" and cms and ms >= 1:
                    out.append(("e2e-stage", f"{k}.{st}", ms, cms))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("baseline", type=Path)
    ap.add_argument("candidate", type=Path)
    ap.add_argument("--force", action="store_true", help="print the table even if the environments differ")
    args = ap.parse_args()
    b, c = load(args.baseline), load(args.candidate)
    bi, ci = b["identity"], c["identity"]

    problems, notes = [], []
    if bi["machine"] != ci["machine"]:
        problems.append(f"CPU architecture differs: {bi['machine']} vs {ci['machine']}")
    if itype(bi) != itype(ci):
        problems.append(f"EC2 instance type differs: {itype(bi)} vs {itype(ci)}")
    if cpu_name(bi) != cpu_name(ci):
        problems.append(f"CPU model differs: {cpu_name(bi)} vs {cpu_name(ci)}")
    if itype(bi) is None or itype(ci) is None:
        notes.append("At least one run was not on EC2 (no IMDS instance type); the comparison is not a Graviton result.")
    if bi["num_threads"] != ci["num_threads"]:
        notes.append(f"cv.getNumThreads differs: {bi['num_threads']} vs {ci['num_threads']}")
    if bi["build_info_sha256"] == ci["build_info_sha256"]:
        notes.append("Both runs used the IDENTICAL OpenCV build (same getBuildInformation hash): this measures run-to-run "
                     "noise, not stock vs COOL.")
    if "cool" in c["label"].lower() and ci["cool"]["state"] != "verified_marker":
        problems.append(f"candidate is labelled '{c['label']}' but COOL state is '{ci['cool']['state']}' "
                        "(set CLEARPATH_COOL_MARKER to a string unique to the COOL build)")
    if b["protocol"]["repeats"] != c["protocol"]["repeats"]:
        notes.append(f"repeats differ: {b['protocol']['repeats']} vs {c['protocol']['repeats']}")

    print(f"## OpenCV benchmark: `{b['label']}` (baseline) vs `{c['label']}` (candidate)\n")
    print("| | baseline | candidate |\n|---|---|---|")
    print(f"| result file | `{args.baseline.name}` | `{args.candidate.name}` |")
    print(f"| OpenCV | {bi['opencv_version']} | {ci['opencv_version']} |")
    print(f"| cv2 module | `{bi['cv2_file']}` | `{ci['cv2_file']}` |")
    print(f"| build sha256 | `{bi['build_info_sha256'][:16]}` | `{ci['build_info_sha256'][:16]}` |")
    print(f"| COOL state | {bi['cool']['state']} | {ci['cool']['state']} |")
    print(f"| machine | {bi['machine']} | {ci['machine']} |")
    print(f"| instance type | {itype(bi)} | {itype(ci)} |")
    print(f"| CPU | {cpu_name(bi)} | {cpu_name(ci)} |")
    print(f"| threads | {bi['num_threads']} | {ci['num_threads']} |")
    print(f"| timestamp | {b['timestamp_utc']} | {c['timestamp_utc']} |\n")

    if problems:
        print("> **NOT COMPARABLE:**\n" + "\n".join(f"> - {p}" for p in problems) + "\n")
        if not args.force:
            print("Refusing to print speedups (use --force to override).")
            sys.exit(2)
        print("> Table printed only because --force was given. Do not cite these numbers as a COOL result.\n")
    for n in notes:
        print(f"> Note: {n}")
    if notes:
        print()

    print("| section | workload | baseline median ms | candidate median ms | speedup (baseline/candidate) |")
    print("|---|---|---:|---:|---:|")
    for section, name, bm, cm in rows(b, c):
        sp = bm / cm if cm > 0 else float("nan")
        print(f"| {section} | {name} | {bm:.3f} | {cm:.3f} | {sp:.2f}x |")
    print("\nSpeedup > 1 means the candidate is faster. Medians of repeated runs; see the JSON files for p90/min and "
          "the full protocol.")


if __name__ == "__main__":
    main()
