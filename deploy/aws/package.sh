#!/usr/bin/env bash
# Build the application bundle (backend + built frontend + deploy files) and upload it to
# s3://<bucket>/app/clearpath.tar.gz. Credentials come only from the standard AWS CLI chain (AWS_PROFILE/env/SSO).
#
#   ./package.sh [bucket]          bucket defaults to $CLEARPATH_S3_BUCKET or BUCKET from .state.env
#   ./package.sh --local-only      build the tarball only (prints its path)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="${CLEARPATH_BUNDLE:-$HERE/.build/clearpath.tar.gz}"
LOCAL_ONLY=0
BUCKET="${CLEARPATH_S3_BUCKET:-}"

for arg in "$@"; do
  case "$arg" in
    --local-only) LOCAL_ONLY=1 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) BUCKET="$arg" ;;
  esac
done
if [[ -z "$BUCKET" && -f "$HERE/.state.env" ]]; then
  # shellcheck disable=SC1091
  source "$HERE/.state.env"
fi

# --- preconditions
[[ -f "$ROOT/frontend/dist/index.html" ]] || { echo "ERROR: frontend/dist missing - build the frontend first (cd frontend && npm ci && npm run build)" >&2; exit 1; }
[[ -f "$ROOT/backend/models/yolox_s_2022nov.onnx" ]] || { echo "ERROR: backend/models/yolox_s_2022nov.onnx missing" >&2; exit 1; }
[[ -f "$ROOT/backend/assets/vtest.avi" ]] || { echo "ERROR: backend/assets/vtest.avi missing (needed by scripts/generate_footage.py)" >&2; exit 1; }
[[ -f "$ROOT/backend/requirements.txt" ]] || { echo "ERROR: backend/requirements.txt missing" >&2; exit 1; }

mkdir -p "$(dirname "$OUT")"
tar -czf "$OUT" -C "$ROOT" \
  --exclude='node_modules' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.pytest_cache' \
  --exclude='.git' \
  --exclude='backend/runtime' \
  --exclude='backend/footage/*.avi' \
  --exclude='deploy/aws/.state.env' \
  --exclude='deploy/aws/.build' \
  backend frontend/dist deploy

# --- sanity check of the bundle contents
LIST="$(tar -tzf "$OUT")"
for f in backend/clearpath/main.py backend/clearpath/vision/service.py backend/models/yolox_s_2022nov.onnx \
         backend/assets/vtest.avi backend/scripts/generate_footage.py frontend/dist/index.html \
         deploy/aws/clearpath-api.service deploy/aws/clearpath-vision.service deploy/aws/nginx.conf; do
  grep -qx "$f" <<<"$LIST" || { echo "ERROR: bundle is missing $f" >&2; exit 1; }
done
if grep -qE '(^|/)(node_modules|__pycache__|\.git)(/|$)|backend/runtime/|backend/footage/.*\.avi$' <<<"$LIST"; then
  echo "ERROR: bundle contains excluded paths" >&2; exit 1
fi
echo "bundle: $OUT ($(du -h "$OUT" | cut -f1), $(wc -l <<<"$LIST") entries)"

if [[ "$LOCAL_ONLY" == 1 ]]; then exit 0; fi
[[ -n "$BUCKET" ]] || { echo "ERROR: no bucket given (arg, CLEARPATH_S3_BUCKET, or .state.env)" >&2; exit 1; }
REGION="${REGION:-${AWS_REGION:-$(aws configure get region || true)}}"
REGION="${REGION:-us-east-1}"
aws s3 cp --region "$REGION" --sse AES256 --only-show-errors "$OUT" "s3://${BUCKET}/app/clearpath.tar.gz"
echo "uploaded s3://${BUCKET}/app/clearpath.tar.gz"
