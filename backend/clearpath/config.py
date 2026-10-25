"""Runtime configuration. All values come from environment variables; no credentials live in source."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

PKG_DIR = Path(__file__).resolve().parent
BACKEND_DIR = PKG_DIR.parent
DATA_DIR = Path(os.getenv("CLEARPATH_DATA_DIR", BACKEND_DIR / "runtime"))
FOOTAGE_DIR = Path(os.getenv("CLEARPATH_FOOTAGE_DIR", BACKEND_DIR / "footage"))
MODELS_DIR = Path(os.getenv("CLEARPATH_MODELS_DIR", BACKEND_DIR / "models"))
LAYOUT_PATH = Path(os.getenv("CLEARPATH_LAYOUT", PKG_DIR / "data" / "school_layout.json"))
SCENARIOS_PATH = Path(os.getenv("CLEARPATH_SCENARIOS", PKG_DIR / "data" / "scenarios.json"))


def _bool(name: str, default: bool = False) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    # Vision service: "local" runs OpenCV in-process; "remote" calls VISION_SERVICE_URL (e.g. Graviton EC2).
    vision_mode: str = field(default_factory=lambda: os.getenv("VISION_MODE", "local"))
    vision_service_url: str = field(default_factory=lambda: os.getenv("VISION_SERVICE_URL", "http://127.0.0.1:8100"))
    vision_api_key: str | None = field(default_factory=lambda: os.getenv("VISION_API_KEY"))
    vision_timeout_s: float = field(default_factory=lambda: float(os.getenv("VISION_TIMEOUT_S", "120")))

    detector_model: Path = field(default_factory=lambda: Path(os.getenv("DETECTOR_MODEL", MODELS_DIR / "yolox_s_2022nov.onnx")))
    weapon_model: Path | None = field(default_factory=lambda: Path(p) if (p := os.getenv("WEAPON_MODEL")) else None)
    detector_conf: float = field(default_factory=lambda: float(os.getenv("DETECTOR_CONF", "0.35")))
    dnn_threads: int = field(default_factory=lambda: int(os.getenv("DNN_THREADS", "0")))

    # AWS (optional). Credentials are resolved by boto3's default chain (env, profile, instance role).
    aws_region: str = field(default_factory=lambda: os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "us-east-1")))
    s3_bucket: str | None = field(default_factory=lambda: os.getenv("CLEARPATH_S3_BUCKET"))
    cloudwatch_enabled: bool = field(default_factory=lambda: _bool("CLEARPATH_CLOUDWATCH", False))
    cloudwatch_namespace: str = field(default_factory=lambda: os.getenv("CLEARPATH_CW_NAMESPACE", "CLEARPATH"))

    # COOL: set when running against a COOL build so the service can report and verify it.
    cool_expected: bool = field(default_factory=lambda: _bool("CLEARPATH_COOL_EXPECTED", False))
    cool_marker: str | None = field(default_factory=lambda: os.getenv("CLEARPATH_COOL_MARKER"))

    agent_max_steps: int = field(default_factory=lambda: int(os.getenv("AGENT_MAX_STEPS", "14")))
    agent_step_delay_s: float = field(default_factory=lambda: float(os.getenv("AGENT_STEP_DELAY_S", "0.35")))
    cors_origins: list[str] = field(default_factory=lambda: os.getenv("CORS_ORIGINS", "*").split(","))


settings = Settings()
DATA_DIR.mkdir(parents=True, exist_ok=True)
