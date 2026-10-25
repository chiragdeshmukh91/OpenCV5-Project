#!/usr/bin/env bash
# Delete everything provision.sh created (recorded in .state.env): instance, security group, IAM role/profile,
# and - unless --keep-bucket - the S3 bucket with its contents (run archives, footage, bundle).
#
#   ./teardown.sh [--yes] [--keep-bucket]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$HERE/.state.env"
YES=0
KEEP_BUCKET=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    --keep-bucket) KEEP_BUCKET=1 ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 1 ;;
  esac
done
[[ -f "$STATE" ]] || { echo "no $STATE - nothing recorded to tear down" >&2; exit 1; }
REGION="" BUCKET="" ROLE="" PROFILE="" SG_ID="" INSTANCE_ID=""
# shellcheck disable=SC1090
source "$STATE"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION" AWS_PAGER=""

echo "Will delete in $REGION: instance ${INSTANCE_ID:-none}, security group ${SG_ID:-none}, role ${ROLE:-none}, profile ${PROFILE:-none}$( [[ $KEEP_BUCKET == 1 ]] && echo ", KEEPING bucket $BUCKET" || echo ", bucket $BUCKET and ALL its objects")"
if [[ "$YES" != 1 ]]; then
  read -r -p "Type 'delete' to continue: " ans
  [[ "$ans" == "delete" ]] || { echo "aborted"; exit 1; }
fi

if [[ -n "${INSTANCE_ID:-}" ]]; then
  echo "== terminating $INSTANCE_ID"
  aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" >/dev/null || true
  aws ec2 wait instance-terminated --instance-ids "$INSTANCE_ID" || true
fi

if [[ -n "${SG_ID:-}" ]]; then
  echo "== deleting security group $SG_ID"
  for i in 1 2 3 4 5 6; do
    if aws ec2 delete-security-group --group-id "$SG_ID" 2>/dev/null; then break; fi
    echo "  still in use (ENI detaching), retry $i"; sleep 10
  done
fi

if [[ -n "${PROFILE:-}" ]]; then
  echo "== deleting instance profile $PROFILE"
  aws iam remove-role-from-instance-profile --instance-profile-name "$PROFILE" --role-name "$ROLE" 2>/dev/null || true
  aws iam delete-instance-profile --instance-profile-name "$PROFILE" 2>/dev/null || true
fi
if [[ -n "${ROLE:-}" ]]; then
  echo "== deleting role $ROLE"
  aws iam detach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore 2>/dev/null || true
  aws iam delete-role-policy --role-name "$ROLE" --policy-name clearpath-least-privilege 2>/dev/null || true
  aws iam delete-role --role-name "$ROLE" 2>/dev/null || true
fi

if [[ "$KEEP_BUCKET" != 1 && -n "${BUCKET:-}" ]]; then
  echo "== emptying and deleting s3://$BUCKET"
  aws s3 rm "s3://$BUCKET" --recursive --only-show-errors || true
  aws s3api delete-bucket --bucket "$BUCKET" || true
fi

echo "== CloudWatch: custom metrics in namespace CLEARPATH cannot be deleted; they expire automatically (15 months) and stop accruing charges once no new data is sent."
rm -f "$STATE"
echo "teardown complete"
