"""Facts about where and on what OpenCV build the vision workload is actually running.

Everything here is measured at runtime (no hard-coded claims): OpenCV version and build information,
CPU architecture, EC2 instance identity via IMDSv2 when available, and whether the loaded OpenCV
matches a configured COOL marker.
"""
from __future__ import annotations

import functools
import os
import platform
import re
import urllib.request

import cv2 as cv

from ..config import settings


def _imds(path: str, token: str) -> str | None:
    req = urllib.request.Request(f"http://169.254.169.254/latest/{path}", headers={"X-aws-ec2-metadata-token": token})
    try:
        with urllib.request.urlopen(req, timeout=0.4) as r:
            return r.read().decode()
    except Exception:
        return None


@functools.lru_cache(maxsize=1)
def ec2_identity() -> dict | None:
    if os.getenv("CLEARPATH_SKIP_IMDS") == "1":
        return None
    try:
        req = urllib.request.Request("http://169.254.169.254/latest/api/token", method="PUT",
                                     headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"})
        with urllib.request.urlopen(req, timeout=0.4) as r:
            token = r.read().decode()
    except Exception:
        return None
    return {
        "instance_type": _imds("meta-data/instance-type", token),
        "instance_id": _imds("meta-data/instance-id", token),
        "region": _imds("meta-data/placement/region", token),
        "az": _imds("meta-data/placement/availability-zone", token),
        "ami_id": _imds("meta-data/ami-id", token),
    }


def _build_field(info: str, key: str) -> str | None:
    m = re.search(rf"^\s*{re.escape(key)}:\s*(.+)$", info, re.MULTILINE)
    return m.group(1).strip() if m else None


@functools.lru_cache(maxsize=1)
def opencv_build() -> dict:
    info = cv.getBuildInformation()
    return {
        "version": cv.__version__,
        "module_path": getattr(cv, "__file__", None),
        "version_control": _build_field(info, "Version control"),
        "platform": _build_field(info, "Host"),
        "compiler": _build_field(info, "C++ Compiler"),
        "cpu_baseline": _build_field(info, "Baseline"),
        "cpu_dispatched": _build_field(info, "Dispatched code generation"),
        "parallel_framework": _build_field(info, "Parallel framework"),
        "threads": cv.getNumThreads(),
        "build_info_sha_prefix": __import__("hashlib").sha256(info.encode()).hexdigest()[:16],
    }


def cool_status() -> dict:
    info = cv.getBuildInformation()
    marker = settings.cool_marker
    found = bool(marker) and (marker.lower() in info.lower() or marker.lower() in str(getattr(cv, "__file__", "")).lower())
    if found:
        state = "verified_marker"
        note = f"Loaded OpenCV build matches COOL marker '{marker}'."
    elif settings.cool_expected:
        state = "expected_not_verified"
        note = "COOL was expected but the configured marker was not found in the loaded OpenCV build."
    else:
        state = "not_in_use"
        note = "Stock OpenCV build in use. COOL integration is modular and benchmarked separately (see benchmarks/)."
    return {"state": state, "marker": marker, "note": note}


def runtime_info() -> dict:
    ec2 = ec2_identity()
    machine = platform.machine()
    return {
        "machine": machine,
        "arm64": machine.lower() in {"aarch64", "arm64"},
        "python": platform.python_version(),
        "os": platform.platform(terse=True),
        "cpu_count": os.cpu_count(),
        "on_aws": bool(ec2 and ec2.get("instance_id")),
        "ec2": ec2,
        "graviton": bool(ec2 and ec2.get("instance_type") and machine.lower() in {"aarch64", "arm64"}),
        "opencv": opencv_build(),
        "cool": cool_status(),
    }
