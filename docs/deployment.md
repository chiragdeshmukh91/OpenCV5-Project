# Deployment (AWS)

The full kit is in [`deploy/aws/`](../deploy/aws/README.md). This page summarises it and lists what you must
configure.

> **Status.** The scripts are **Implemented**. A deployment of commit `a3e70d5` was **Reported** by the team on
> 2026-10-26, on `t4g.small` at `52.70.58.148`. The **current code is not deployed**. Redeploy, then run `verify.sh`
> before claiming that the live endpoint runs this version.
>
> Deploying creates billable resources. Do not run `provision.sh` without the account owner's approval.

## What gets created

* **EC2:** one Ubuntu 24.04 arm64 Graviton instance, with IMDSv2 required and a 20 GiB encrypted gp3 volume. No key
  pair is created, and no Docker is used. It runs nginx, the `clearpath-api` and `clearpath-vision` systemd services
  (`VISION_MODE=remote`), and generates the footage on first boot.
* **S3:** a private bucket `clearpath-<account>-<region>` with public access blocked and SSE-S3. It holds `app/`
  (bundle), `footage/` and `runs/` (run archives).
* **IAM:** an instance role with these permissions:
  * `s3:GetObject` and `s3:PutObject` on the three prefixes only;
  * `s3:ListBucket` on the bucket;
  * `cloudwatch:PutMetricData` with the condition namespace `CLEARPATH`;
  * `AmazonSSMManagedInstanceCore`, so you get a Session Manager shell and no SSH.
* **Security group:** TCP 80 from your /32 only by default. `--public` opens it to `0.0.0.0/0` for judges.
* **CloudWatch:** custom metrics `VisionTotalMs`, `DetectMs` and `FlowMs`, with `Arch`, `OpenCV` and `COOL`
  dimensions.

## Required configuration

| Item | How |
|---|---|
| AWS credentials | An IAM Identity Center (SSO) or IAM user profile: `aws configure sso`, then `export AWS_PROFILE=...`. The **root** user is refused unless `CLEARPATH_ALLOW_ROOT=1`. |
| Region | `--region` or the CLI default (the scripts were written for `us-east-1`) |
| Instance type | `--instance-type`, which must be arm64. Script default `c7g.xlarge`; the team's earlier deployment used `t4g.small`. |
| Access CIDR | `--cidr <ip>/32` (default: your public IP), or `--public` for judging |
| Local tools | AWS CLI v2, bash, curl, python3, tar, and Node 20+ to build the UI |

## Deploy

Run from bash: Linux, macOS, WSL or AWS CloudShell.

```bash
cd frontend && npm ci && npm run build && cd ..
cd deploy/aws
./provision.sh --region us-east-1 --instance-type t4g.small --public
# about 10-15 min of first-boot bootstrap; follow it with SSM:
#   aws ssm start-session --target "$INSTANCE_ID"; sudo tail -f /var/log/clearpath-bootstrap.log
./verify.sh            # prints PASS/FAIL for each check below
```

`verify.sh` checks:

1. `/api/health` and `/v1/health` report `machine=aarch64` and the EC2 instance type, read from IMDSv2.
2. The API uses the remote vision service and has credentials from the instance role.
3. Scenario S2 runs end to end:
   * the first recommendation is `LOCKDOWN` (report only; observations pending);
   * after confirming the observations, the recommendation is `LOCKDOWN_PLUS_EVACUATE`;
   * every analysis reports `aarch64`;
   * approval produces SIMULATED actions only.
4. CloudWatch has `VisionTotalMs` datapoints with `Arch=aarch64`.
5. S3 has the `runs/<id>.json` archive.

To **update** a running deployment, run `./package.sh`, then the `ssm send-command` in `deploy/aws/README.md`
§3. To **tear down**, run `./teardown.sh`.

## Cost

These estimates use on-demand prices in us-east-1. Check the current pricing for your region.

| Resource | Approximate cost |
|---|---|
| `t4g.small` (2 vCPU Graviton2, 2 GiB) | $0.0168/h, about $12.26 per month 24/7 (third-party price calculator, checked 2026-10-26) |
| `c7g.xlarge` (4 vCPU Graviton3, 8 GiB) | about $0.145/h (estimate in `deploy/aws/README.md`, not re-checked) |
| 20 GiB gp3, S3, CloudWatch custom metrics | a few dollars per month |

## Not included

* HTTPS: put CloudFront or an ALB with ACM in front.
* Authentication on review actions.
* Persistence of in-progress runs across restarts.
* Autoscaling.

These need to be added for anything beyond a judged demo.
