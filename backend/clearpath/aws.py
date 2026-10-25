"""Optional AWS integration (S3 artifacts/footage, CloudWatch metrics). Uses boto3's default credential
chain only; nothing is hard-coded. Every call degrades gracefully and reports its real status."""
from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from typing import Any

from .config import settings

log = logging.getLogger("clearpath.aws")

try:
    import boto3  # type: ignore
    from botocore.config import Config  # type: ignore
except Exception:  # pragma: no cover
    boto3 = None
    Config = None

_status: dict[str, Any] = {"checked_at": 0.0}
_lock = threading.Lock()


def _client(name: str):
    if boto3 is None:
        raise RuntimeError("boto3 not installed")
    return boto3.client(name, region_name=settings.aws_region,
                        config=Config(connect_timeout=2, read_timeout=5, retries={"max_attempts": 1}))


def status(force: bool = False) -> dict[str, Any]:
    """Real connectivity check (STS GetCallerIdentity + S3 HeadBucket), cached for 60 s."""
    with _lock:
        if not force and time.time() - _status["checked_at"] < 60:
            return dict(_status)
        st: dict[str, Any] = {"checked_at": time.time(), "region": settings.aws_region, "boto3": boto3 is not None,
                              "s3_bucket": settings.s3_bucket, "cloudwatch": settings.cloudwatch_enabled}
        if boto3 is None:
            st.update(connected=False, reason="boto3 not installed")
        else:
            try:
                ident = _client("sts").get_caller_identity()
                st.update(connected=True, account_suffix=str(ident.get("Account", ""))[-4:],
                          principal_type=str(ident.get("Arn", "")).split(":")[5].split("/")[0] if ident.get("Arn") else None)
            except Exception as e:  # no credentials, no network, etc.
                st.update(connected=False, reason=type(e).__name__)
            if st.get("connected") and settings.s3_bucket:
                try:
                    _client("s3").head_bucket(Bucket=settings.s3_bucket)
                    st["s3_ok"] = True
                except Exception as e:
                    st.update(s3_ok=False, s3_reason=type(e).__name__)
        _status.clear()
        _status.update(st)
        return dict(st)


def put_json(key: str, payload: Any) -> str | None:
    if not settings.s3_bucket or boto3 is None:
        return None
    try:
        _client("s3").put_object(Bucket=settings.s3_bucket, Key=key, Body=json.dumps(payload, default=str).encode(),
                                 ContentType="application/json")
        return f"s3://{settings.s3_bucket}/{key}"
    except Exception as e:
        log.warning("S3 put failed: %s", e)
        return None


def fetch_footage(name: str, dest: Path) -> bool:
    if not settings.s3_bucket or boto3 is None:
        return False
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        _client("s3").download_file(settings.s3_bucket, f"footage/{name}", str(dest))
        return True
    except Exception as e:
        log.warning("S3 footage fetch failed: %s", e)
        return False


def put_metrics(metrics: dict[str, float], dims: dict[str, str]) -> None:
    if not settings.cloudwatch_enabled or boto3 is None:
        return

    def _send():
        try:
            _client("cloudwatch").put_metric_data(
                Namespace=settings.cloudwatch_namespace,
                MetricData=[{"MetricName": k, "Value": float(v), "Unit": "Milliseconds",
                             "Dimensions": [{"Name": dk, "Value": dv} for dk, dv in dims.items()]}
                            for k, v in metrics.items()])
        except Exception as e:
            log.warning("CloudWatch put failed: %s", e)

    threading.Thread(target=_send, daemon=True).start()
