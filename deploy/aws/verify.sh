#!/usr/bin/env bash
# Prove the deployment works and that the OpenCV workload runs on Graviton:
#   1. API + vision health; /v1/health must report machine=aarch64 and an EC2 instance type
#   2. run scenario S2 through the API, wait for awaiting_review, approve (SIMULATED) so the run is archived
#   3. CloudWatch: VisionTotalMs datapoints in namespace CLEARPATH with dimension Arch=aarch64
#   4. S3: runs/*.json archives
#
#   ./verify.sh [http://PUBLIC_IP]      (defaults to URL from .state.env)
# Needs: curl, python3, AWS CLI v2 with the same profile used for provision.sh.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$HERE/.state.env"
URL="" REGION="${AWS_REGION:-}" BUCKET=""
if [[ -f "$STATE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE"
fi
URL="${1:-$URL}"
[[ -n "$URL" ]] || { echo "usage: $0 http://PUBLIC_IP (or run provision.sh first)" >&2; exit 1; }
URL="${URL%/}"
REGION="${REGION:-us-east-1}"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION" AWS_PAGER=""
FAIL=0
ok()   { echo "  PASS  $*"; }
bad()  { echo "  FAIL  $*"; FAIL=1; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {}, {'d': d}))" "$1"; }

echo "== 1. health ($URL)"
curl -fsS --max-time 10 "$URL/api/health" >/dev/null && ok "/api/health" || { bad "/api/health unreachable (bootstrap still running? security group CIDR?)"; exit 1; }
VH="$(curl -fsS --max-time 20 "$URL/v1/health")"
MACHINE="$(json "d['runtime']['machine']" <<<"$VH")"
ITYPE="$(json "(d['runtime']['ec2'] or {}).get('instance_type')" <<<"$VH")"
OCV="$(json "d['runtime']['opencv']['version']" <<<"$VH")"
COOL="$(json "d['runtime']['cool']['state']" <<<"$VH")"
echo "  vision service: machine=$MACHINE instance_type=$ITYPE opencv=$OCV cool=$COOL graviton=$(json "d['runtime']['graviton']" <<<"$VH")"
[[ "$MACHINE" == "aarch64" ]] && ok "OpenCV vision service runs on aarch64" || bad "machine is $MACHINE, expected aarch64"
[[ "$ITYPE" != "None" && -n "$ITYPE" ]] && ok "EC2 instance type from IMDSv2: $ITYPE" || bad "no EC2 instance type reported"
ST="$(curl -fsS --max-time 20 "$URL/api/status")"
[[ "$(json "d['vision']['mode']" <<<"$ST")" == "remote" ]] && ok "API uses the vision service over HTTP (VISION_MODE=remote)" || bad "API vision mode is not remote"
[[ "$(json "d['aws'].get('connected')" <<<"$ST")" == "True" ]] && ok "API has AWS credentials via instance role" || bad "API AWS status: $(json "d['aws']" <<<"$ST")"

echo "== 2. scenario S2 via the API"
RUN_ID="$(curl -fsS -X POST -H 'content-type: application/json' -d '{"scenario_id":"S2-corroborated-east"}' "$URL/api/runs" | json "d['run_id']")"
echo "  run $RUN_ID"
STATUS="" T0=$SECONDS
while (( SECONDS - T0 < 600 )); do
  STATUS="$(curl -fsS --max-time 10 "$URL/api/runs/$RUN_ID" | json "d['status']")"
  [[ "$STATUS" == "awaiting_review" || "$STATUS" == "error" ]] && break
  sleep 3
done
RUN="$(curl -fsS "$URL/api/runs/$RUN_ID")"
if [[ "$STATUS" == "awaiting_review" ]]; then
  REC="$(json "d['assessment']['recommended']" <<<"$RUN")"
  echo "  $(json "d['metrics']" <<<"$RUN")  ($((SECONDS - T0)) s)"
  [[ "$REC" == "LOCKDOWN_PLUS_EVACUATE" ]] && ok "recommended $REC (expected LOCKDOWN_PLUS_EVACUATE)" || bad "recommended $REC"
  MACHINES="$(json "sorted({a['service'].get('machine') for a in d['analyses'].values()})" <<<"$RUN")"
  [[ "$MACHINES" == "['aarch64']" ]] && ok "every analysis in the run reports service machine aarch64" || bad "analysis service machines $MACHINES"
  curl -fsS -X POST -H 'content-type: application/json' -d '{"action":"approve","reviewer":"verify.sh","note":"deployment check (simulated)"}' \
    "$URL/api/runs/$RUN_ID/review" >/dev/null && ok "approved (SIMULATED actions only); run will be archived to S3"
else
  bad "run status $STATUS after $((SECONDS - T0)) s: $(json "d.get('error')" <<<"$RUN")"
fi

echo "== 3. CloudWatch metrics (namespace CLEARPATH, Arch=aarch64)"
read -r START END < <(python3 -c "import datetime as t; n=t.datetime.now(t.timezone.utc); f='%Y-%m-%dT%H:%M:%SZ'; print((n-t.timedelta(hours=1)).strftime(f), (n+t.timedelta(minutes=5)).strftime(f))")
N=0
for _ in $(seq 1 12); do  # custom metrics can take a minute or two to become queryable
  N="$(aws cloudwatch get-metric-statistics --namespace CLEARPATH --metric-name VisionTotalMs \
        --dimensions Name=Arch,Value=aarch64 Name=OpenCV,Value="$OCV" Name=COOL,Value="$COOL" \
        --start-time "$START" --end-time "$END" --period 3600 --statistics SampleCount Average \
        --query 'sum(Datapoints[].SampleCount)' --output text 2>/dev/null || echo 0)"
  [[ "$N" != "None" && "${N%.*}" -gt 0 ]] 2>/dev/null && break
  sleep 15
done
if [[ "$N" != "None" && "${N%.*}" -gt 0 ]] 2>/dev/null; then
  ok "VisionTotalMs: ${N%.*} samples in the last hour with Arch=aarch64, OpenCV=$OCV, COOL=$COOL"
  aws cloudwatch get-metric-statistics --namespace CLEARPATH --metric-name VisionTotalMs \
    --dimensions Name=Arch,Value=aarch64 Name=OpenCV,Value="$OCV" Name=COOL,Value="$COOL" \
    --start-time "$START" --end-time "$END" --period 3600 --statistics SampleCount Average Maximum --output table
else
  bad "no VisionTotalMs datapoints yet (try again in a minute)"
fi

echo "== 4. S3 run archives"
sleep 3
if [[ -n "$BUCKET" ]] && aws s3 ls "s3://$BUCKET/runs/" | tail -n 5; then
  aws s3 ls "s3://$BUCKET/runs/$RUN_ID.json" >/dev/null && ok "s3://$BUCKET/runs/$RUN_ID.json" || bad "run $RUN_ID not archived yet"
else
  bad "cannot list s3://${BUCKET:-?}/runs/"
fi

echo
[[ "$FAIL" == 0 ]] && echo "ALL CHECKS PASSED" || { echo "SOME CHECKS FAILED"; exit 1; }
