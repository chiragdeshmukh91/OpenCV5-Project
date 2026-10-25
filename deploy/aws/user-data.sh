#!/bin/bash
# CLEARPATH first-boot bootstrap for Ubuntu 24.04 arm64 (AWS Graviton). Rendered by provision.sh, which replaces
# __BUCKET__ and __REGION__. Runs once as root via cloud-init. No Docker: Python venv + systemd + nginx.
# Log: /var/log/clearpath-bootstrap.log   Done marker: /var/lib/clearpath-bootstrap.done
set -euo pipefail
exec > >(tee -a /var/log/clearpath-bootstrap.log) 2>&1
echo "== CLEARPATH bootstrap start $(date -u +%FT%TZ)"

BUCKET="__BUCKET__"
REGION="__REGION__"
APP=/opt/clearpath
export HOME=/root
export DEBIAN_FRONTEND=noninteractive

# --- OS packages (python3 is 3.12 on Ubuntu 24.04)
apt-get update -y
apt-get install -y --no-install-recommends python3-venv python3-pip nginx unzip curl ca-certificates

# --- AWS CLI v2 (used only to pull the bundle and push footage; the app itself uses boto3)
if ! command -v aws >/dev/null 2>&1; then
  ARCH="$(uname -m)"   # aarch64 on Graviton
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${ARCH}.zip" -o /tmp/awscliv2.zip
  unzip -q -o /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install
fi

# --- service user and application bundle (built by package.sh: backend + frontend/dist + deploy)
id clearpath >/dev/null 2>&1 || useradd --system --home-dir /var/lib/clearpath --shell /usr/sbin/nologin clearpath
mkdir -p "$APP" /etc/clearpath /var/lib/clearpath
for i in $(seq 1 30); do
  if aws s3 cp --region "$REGION" "s3://${BUCKET}/app/clearpath.tar.gz" /tmp/clearpath.tar.gz; then break; fi
  echo "bundle not available yet (attempt $i), retrying in 20 s"; sleep 20
done
test -s /tmp/clearpath.tar.gz
tar -xzf /tmp/clearpath.tar.gz -C "$APP"
test -f "$APP/backend/models/yolox_s_2022nov.onnx"
test -f "$APP/backend/assets/vtest.avi"

# --- Python environment
python3 -m venv "$APP/venv"
"$APP/venv/bin/pip" install --upgrade pip
"$APP/venv/bin/pip" install -r "$APP/backend/requirements.txt"
"$APP/venv/bin/python" -c "import cv2, platform; print('OpenCV', cv2.__version__, 'on', platform.machine())"

# --- synthetic camera footage (deterministic; recomposited from the bundled OpenCV sample vtest.avi)
mkdir -p "$APP/backend/footage"
(cd "$APP/backend" && "$APP/venv/bin/python" scripts/generate_footage.py)
# Copy footage to S3 so a separately hosted vision service can fetch clips (footage/* prefix; PutObject only).
aws s3 cp --region "$REGION" --recursive --only-show-errors "$APP/backend/footage" "s3://${BUCKET}/footage/" \
  || echo "WARN: footage upload to S3 failed (non-fatal)"
chown -R clearpath:clearpath "$APP/backend/footage" /var/lib/clearpath

# --- service environment (no credentials: boto3 uses the instance role via IMDSv2)
cat > /etc/clearpath/clearpath.env <<EOF
AWS_REGION=${REGION}
AWS_DEFAULT_REGION=${REGION}
CLEARPATH_S3_BUCKET=${BUCKET}
CLEARPATH_CLOUDWATCH=1
CLEARPATH_DATA_DIR=/var/lib/clearpath
PYTHONDONTWRITEBYTECODE=1
EOF
chmod 0644 /etc/clearpath/clearpath.env

# --- systemd units and nginx
install -m 0644 "$APP/deploy/aws/clearpath-vision.service" /etc/systemd/system/clearpath-vision.service
install -m 0644 "$APP/deploy/aws/clearpath-api.service" /etc/systemd/system/clearpath-api.service
install -m 0644 "$APP/deploy/aws/nginx.conf" /etc/nginx/sites-available/clearpath
ln -sf /etc/nginx/sites-available/clearpath /etc/nginx/sites-enabled/clearpath
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl daemon-reload
systemctl enable --now clearpath-vision.service
systemctl enable --now clearpath-api.service
systemctl enable nginx
systemctl restart nginx

# --- wait for health
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8100/v1/health >/dev/null && curl -fsS http://127.0.0.1:8000/api/health >/dev/null; then
    echo "services healthy"; break
  fi
  sleep 3
done
curl -fsS http://127.0.0.1/v1/health | head -c 600; echo
touch /var/lib/clearpath-bootstrap.done
echo "== CLEARPATH bootstrap done $(date -u +%FT%TZ)"
