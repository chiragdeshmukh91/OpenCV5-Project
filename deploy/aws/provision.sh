#!/usr/bin/env bash
# Provision CLEARPATH on ONE AWS Graviton EC2 instance (no Docker, no SSH key):
#   S3 bucket (public access blocked, SSE-S3) -> IAM role + instance profile (least privilege + SSM core)
#   -> security group (HTTP 80 from one CIDR) -> bundle upload (package.sh) -> Ubuntu 24.04 arm64 instance.
#
# Credentials: ONLY the standard AWS CLI chain (AWS_PROFILE / env vars / SSO / config). Never paste keys here.
# Use an IAM Identity Center (SSO) profile or IAM user - NOT the root account.
#
#   ./provision.sh [--region us-east-1] [--instance-type c7g.xlarge] [--cidr 203.0.113.7/32] [--bucket NAME]
#
# Writes deploy/aws/.state.env (used by verify.sh and teardown.sh). Costs money while running: see README.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$HERE/.state.env"
REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || true)}"
REGION="${REGION:-us-east-1}"
INSTANCE_TYPE="c7g.xlarge"
CIDR=""
BUCKET=""
NAME="clearpath"
VOLUME_GB=20
AMI_PARAM="/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    --instance-type) INSTANCE_TYPE="$2"; shift 2 ;;
    --cidr) CIDR="$2"; shift 2 ;;
    --bucket) BUCKET="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION" AWS_PAGER=""
TAGS_KV="Key=Project,Value=CLEARPATH"

log() { printf '\n== %s\n' "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

command -v aws >/dev/null || die "AWS CLI v2 not found"
command -v curl >/dev/null || die "curl not found"
[[ -f "$STATE" ]] && die "$STATE exists - an environment is already provisioned (run ./teardown.sh first)"

# --- identity (refuse the root account)
log "Caller identity"
CALLER_ARN="$(aws sts get-caller-identity --query Arn --output text)" || die "no AWS credentials (configure an SSO/IAM profile: aws configure sso)"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "account ...${ACCOUNT: -4}  principal ${CALLER_ARN##*:}  region $REGION"
if [[ "$CALLER_ARN" == *":root" ]]; then
  [[ "${CLEARPATH_ALLOW_ROOT:-0}" == 1 ]] || die "you are using the ROOT account. Create an IAM Identity Center (SSO) user or IAM user with admin rights and use its profile (export AWS_PROFILE=...). Set CLEARPATH_ALLOW_ROOT=1 only if you really must."
fi

# --- inputs
BUCKET="${BUCKET:-clearpath-${ACCOUNT}-${REGION}}"
if [[ -z "$CIDR" ]]; then
  MYIP="$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')"
  [[ "$MYIP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "could not determine your public IP; pass --cidr"
  CIDR="${MYIP}/32"
fi
ARCHS="$(aws ec2 describe-instance-types --instance-types "$INSTANCE_TYPE" \
          --query 'InstanceTypes[0].ProcessorInfo.SupportedArchitectures' --output text)"
[[ "$ARCHS" == *arm64* ]] || die "$INSTANCE_TYPE is not an arm64 (Graviton) instance type (got: $ARCHS)"
AMI_ID="$(aws ssm get-parameter --name "$AMI_PARAM" --query Parameter.Value --output text)"
VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
[[ "$VPC_ID" != "None" && -n "$VPC_ID" ]] || die "no default VPC in $REGION (create one: aws ec2 create-default-vpc)"
echo "instance $INSTANCE_TYPE ($ARCHS)  AMI $AMI_ID  VPC $VPC_ID  HTTP allowed from $CIDR  bucket $BUCKET"

ROLE="${NAME}-ec2-role"
PROFILE="${NAME}-ec2-profile"
SG_NAME="${NAME}-web"
# Record what we create as we go, so teardown.sh can clean up even after a partial failure.
{
  echo "REGION=$REGION"; echo "ACCOUNT=$ACCOUNT"; echo "BUCKET=$BUCKET"; echo "ROLE=$ROLE"; echo "PROFILE=$PROFILE"
  echo "INSTANCE_TYPE=$INSTANCE_TYPE"; echo "CIDR=$CIDR"
} > "$STATE"

# --- S3 bucket: private, encrypted, tagged
log "S3 bucket $BUCKET"
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "bucket exists (reusing)"
elif [[ "$REGION" == "us-east-1" ]]; then
  aws s3api create-bucket --bucket "$BUCKET" >/dev/null
else
  aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws s3api put-bucket-tagging --bucket "$BUCKET" --tagging 'TagSet=[{Key=Project,Value=CLEARPATH}]'

# --- IAM role (least privilege) + SSM core + instance profile
log "IAM role $ROLE"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
sed "s|__BUCKET__|${BUCKET}|g" "$HERE/iam-policy.json" > "$TMP/policy.json"
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document "file://$HERE/trust-policy.json" \
    --description "CLEARPATH EC2 instance role" --tags "$TAGS_KV" >/dev/null
fi
aws iam put-role-policy --role-name "$ROLE" --policy-name clearpath-least-privilege --policy-document "file://$TMP/policy.json"
aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
if ! aws iam get-instance-profile --instance-profile-name "$PROFILE" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$PROFILE" --tags "$TAGS_KV" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE" --role-name "$ROLE"
fi
aws iam wait instance-profile-exists --instance-profile-name "$PROFILE"

# --- security group: HTTP from one CIDR only; no SSH (use SSM Session Manager)
log "Security group $SG_NAME"
SG_ID="$(aws ec2 describe-security-groups --filters Name=group-name,Values="$SG_NAME" Name=vpc-id,Values="$VPC_ID" \
          --query 'SecurityGroups[0].GroupId' --output text)"
if [[ "$SG_ID" == "None" || -z "$SG_ID" ]]; then
  SG_ID="$(aws ec2 create-security-group --group-name "$SG_NAME" --vpc-id "$VPC_ID" \
            --description "CLEARPATH HTTP from operator CIDR" \
            --tag-specifications "ResourceType=security-group,Tags=[{$TAGS_KV}]" --query GroupId --output text)"
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=$CIDR,Description=clearpath-operator}]" >/dev/null
fi
echo "SG_ID=$SG_ID" >> "$STATE"

# --- application bundle
log "Packaging and uploading the application bundle"
CLEARPATH_S3_BUCKET="$BUCKET" REGION="$REGION" "$HERE/package.sh" "$BUCKET"

# --- instance
log "Launching $INSTANCE_TYPE"
sed -e "s|__BUCKET__|${BUCKET}|g" -e "s|__REGION__|${REGION}|g" "$HERE/user-data.sh" > "$TMP/user-data.sh"
INSTANCE_ID=""
for attempt in 1 2 3 4 5 6; do  # a brand-new instance profile can take a few seconds to become usable
  if INSTANCE_ID="$(aws ec2 run-instances \
        --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" \
        --iam-instance-profile "Name=$PROFILE" --security-group-ids "$SG_ID" \
        --user-data "file://$TMP/user-data.sh" \
        --metadata-options HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=1 \
        --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=${VOLUME_GB},VolumeType=gp3,Encrypted=true,DeleteOnTermination=true}" \
        --tag-specifications "ResourceType=instance,Tags=[{$TAGS_KV},{Key=Name,Value=clearpath}]" \
                             "ResourceType=volume,Tags=[{$TAGS_KV}]" \
        --query 'Instances[0].InstanceId' --output text 2>"$TMP/err")"; then
    break
  fi
  grep -q "Invalid IAM Instance Profile" "$TMP/err" || { cat "$TMP/err" >&2; exit 1; }
  echo "instance profile not yet propagated (attempt $attempt); retrying in 10 s"; sleep 10
done
[[ -n "$INSTANCE_ID" ]] || die "run-instances failed"
echo "INSTANCE_ID=$INSTANCE_ID" >> "$STATE"
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
PUBLIC_IP="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
              --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)"
echo "PUBLIC_IP=$PUBLIC_IP" >> "$STATE"
echo "URL=http://$PUBLIC_IP" >> "$STATE"

log "Done"
cat <<EOF
Instance   $INSTANCE_ID ($INSTANCE_TYPE, Ubuntu 24.04 arm64)  in $REGION
URL        http://$PUBLIC_IP          (reachable only from $CIDR)
Bootstrap  takes ~5-10 min (packages, venv, footage generation). Follow it with:
             aws ssm start-session --target $INSTANCE_ID     then: sudo tail -f /var/log/clearpath-bootstrap.log
Verify     ./verify.sh
Teardown   ./teardown.sh        (the instance costs money until you do)
State      $STATE
EOF
