"""Generate the synthetic camera clips used by the scenarios.

Usage:  python scripts/generate_footage.py [--src assets/vtest.avi]
Downloads OpenCV's public sample `vtest.avi` if it is not present.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from clearpath.config import FOOTAGE_DIR, SCENARIOS_PATH  # noqa: E402
from clearpath.vision.detector import get_detector  # noqa: E402
from clearpath.vision.synth import generate_all  # noqa: E402

VTEST_URL = "https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/vtest.avi"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=Path(__file__).resolve().parents[1] / "assets" / "vtest.avi")
    ap.add_argument("--out", type=Path, default=FOOTAGE_DIR)
    args = ap.parse_args()
    if not args.src.exists():
        args.src.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {VTEST_URL}")
        urllib.request.urlretrieve(VTEST_URL, args.src)
    clips = json.loads(SCENARIOS_PATH.read_text())["clips"]
    manifest = generate_all(args.src, args.out, clips, get_detector())
    print(f"Generated {len(manifest['clips'])} clips from {manifest['sprites']} sprites into {args.out}")


if __name__ == "__main__":
    main()
