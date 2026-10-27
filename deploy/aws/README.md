# CLEARPATH on AWS Graviton (no containers)

One Ubuntu 24.04 **arm64** EC2 instance (default `c7g.xlarge`, Graviton3) runs everything as plain systemd services:

```
 operator browser (your IP only)
        |  HTTP :80
     [nginx] --- GET /v1/health -------------------------------+
        |                                                      |
        v 127.0.0.1:8000                                       v 127.0.0.1:8100
 clearpath-api.service                          clearpath-vision.service
 uvicorn clearpath.main:app                     uvicorn clearpath.vision.service:app
 agent + twin + decision engine + built UI      OpenCV 5: quality checks, dehaze/CLAHE, MOG2,
 VISION_MODE=remote  --- HTTP /v1/analyze --->  Farneback flow, YOLOX (cv.dnn), tracking
        |                                                      |
        +---- S3 runs/*.json (run archives)                    +---- CloudWatch namespace CLEARPATH
                                                                     (VisionTotalMs, DetectMs, FlowMs;
                                                                      dims Arch / OpenCV / COOL)
```

The API never runs OpenCV analysis in-process here: every camera analysis is an HTTP call to the vision service,
the same service that can run on its own instance (see "Splitting vision onto its own instance").

Everything is a **simulation**: scenarios, triggers and footage are synthetic, and approved actions are only
logged as `SIMULATED`.

## Cost warning

This creates billable resources. Approximate on-demand prices in us-east-1 at time of writing (check the EC2
pricing page for your region):

| resource | approx. cost |
|---|---|
| `c7g.xlarge` (4 vCPU, 8 GiB) - default | ~$0.145 / hour (~$3.50 / day) |
| `t4g.medium` (2 vCPU burstable, 4 GiB) - cheaper option, slower analyses | ~$0.034 / hour |
| 20 GiB gp3 root volume | ~$1.60 / month |
| S3 (bundle ~40 MB, footage, run JSON), CloudWatch custom metrics (~3 metrics x dimension sets), SSM | cents to a few dollars / month |

**Run `./teardown.sh` when you are done.** The instance bills every hour it runs.

## 0. Credentials - do not use the root account

* Do **not** use your AWS root account (email + password) or root access keys for this. Create an IAM Identity
  Center (SSO) user with an admin permission set, or an IAM user, and use its CLI profile:
  ```bash
  aws configure sso            # once; creates a named profile
  export AWS_PROFILE=<that-profile>
  aws sts get-caller-identity  # must NOT end in ":root"
  ```
* All scripts take credentials **only** from the standard AWS CLI chain (profile / SSO / env). No keys are written
  to files, user data or the instance; the instance uses its IAM role via IMDSv2. `provision.sh` refuses to run as
  root unless you explicitly set `CLEARPATH_ALLOW_ROOT=1`.

Requirements on your machine: AWS CLI v2, bash, curl, python3, tar. The frontend must already be built
(`frontend/dist/`).

## 1. Provision

```bash
cd frontend && npm ci && npm run build && cd ..          # produces frontend/dist
cd deploy/aws
./provision.sh                                          # defaults: your CLI region, c7g.xlarge, your IP/32
# options: --region eu-west-1 --instance-type t4g.medium --cidr 203.0.113.7/32 --bucket my-clearpath-bucket
```

What it does, in order (every resource is tagged `Project=CLEARPATH`; IDs go to `deploy/aws/.state.env`):

1. Refuses a root caller; resolves your public IP via `https://checkip.amazonaws.com` (HTTP is only allowed from
   that `/32`, or from `--cidr`); checks the instance type is arm64; reads the Ubuntu 24.04 arm64 AMI from SSM
   parameter `/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id`.
2. **S3 bucket** `clearpath-<account>-<region>`: public access fully blocked, default SSE-S3 encryption.
3. **IAM role + instance profile** `clearpath-ec2-role` / `clearpath-ec2-profile`:
   * inline policy from `iam-policy.json` (bucket name substituted):
     `s3:GetObject`/`s3:PutObject` only on `runs/*`, `footage/*`, `app/*`;
     `s3:ListBucket` on that one bucket (needed for the HeadBucket check behind `/api/status`; lists keys of
     this bucket only); `cloudwatch:PutMetricData` only with condition `cloudwatch:namespace = CLEARPATH`;
   * AWS managed `AmazonSSMManagedInstanceCore` (shell access through Session Manager, so no SSH key and no port 22).
4. **Security group** `clearpath-web`: inbound TCP 80 from your CIDR only.
5. **Bundle**: `package.sh` tars `backend/` (code, YOLOX model `backend/models/yolox_s_2022nov.onnx`, OpenCV sample
   `backend/assets/vtest.avi`), `frontend/dist/` and `deploy/`, excluding `node_modules`, `runtime`,
   `__pycache__`, `.git`, `backend/footage/*.avi`, and uploads it to `s3://<bucket>/app/clearpath.tar.gz`.
6. **Instance**: `run-instances` with IMDSv2 required, encrypted 20 GiB gp3, no key pair, user data =
   `user-data.sh`, which installs `python3-venv nginx unzip` (+ AWS CLI v2), pulls the bundle, creates
   `/opt/clearpath/venv`, `pip install -r backend/requirements.txt` (aarch64/py3.12 wheels verified), generates the
   synthetic footage with `scripts/generate_footage.py` (deterministic, from the bundled `vtest.avi`), copies it to
   `s3://<bucket>/footage/`, writes `/etc/clearpath/clearpath.env`
   (`CLEARPATH_S3_BUCKET`, `CLEARPATH_CLOUDWATCH=1`, `AWS_REGION`, `CLEARPATH_DATA_DIR=/var/lib/clearpath`),
   installs `clearpath-vision.service`, `clearpath-api.service` (`VISION_MODE=remote`,
   `VISION_SERVICE_URL=http://127.0.0.1:8100`) and `nginx.conf`, and starts them.

Bootstrap takes about 5-10 minutes after the instance is running. Watch it:

```bash
source .state.env
aws ssm start-session --target "$INSTANCE_ID"      # needs the Session Manager plugin for the AWS CLI
sudo tail -f /var/log/clearpath-bootstrap.log       # ends with "CLEARPATH bootstrap done"
sudo systemctl status clearpath-vision clearpath-api nginx
sudo journalctl -u clearpath-vision -f
```

Then open the printed `http://<public-ip>` from the same network.

## 2. Verify - and prove the OpenCV workload runs on Graviton

```bash
./verify.sh
```

It checks, and prints evidence for, each of these:

| claim | evidence |
|---|---|
| The OpenCV service runs on Graviton | `GET http://<ip>/v1/health` -> `runtime.machine = "aarch64"`, `runtime.ec2.instance_type = "c7g.xlarge"` (from IMDSv2 on the instance itself), `runtime.graviton = true`, plus `runtime.opencv` (version, module path, build-info hash) |
| The agent's analyses were done there | `GET /api/runs/<id>` -> every `analyses[*].service.machine = "aarch64"` and `instance_type`; `/api/status` -> `vision.mode = "remote"` |
| Measured on AWS, not claimed | CloudWatch namespace **`CLEARPATH`**, metric `VisionTotalMs` (also `DetectMs`, `FlowMs`) with dimensions **`Arch=aarch64`**, `OpenCV=<version>`, `COOL=<state>` - `aws cloudwatch get-metric-statistics ...` |
| Runs are archived | `aws s3 ls s3://<bucket>/runs/` -> `runs/<run_id>.json` (full trace, belief, routes, review, timings) |

`verify.sh` starts scenario S2 via the API and waits for `awaiting_review`. Because the synthetic footage is not
registered to any camera, the first recommendation is the report-only `LOCKDOWN` with all observations pending. The
script then confirms the observation locations (one reviewer decision), checks the re-assessed recommendation
(`LOCKDOWN_PLUS_EVACUATE`), approves it (simulated) so the run is archived, and queries CloudWatch and S3.

Manual equivalents:

```bash
curl -s http://$PUBLIC_IP/v1/health | python3 -m json.tool | head -40
aws cloudwatch list-metrics --namespace CLEARPATH
aws s3 ls s3://$BUCKET/runs/
```

COOL: the deployed instance uses stock `opencv-python-headless` 5.0.0.93, so `/v1/health` reports
`cool.state = "not_in_use"`. To evaluate COOL on this instance, follow `backend/benchmarks/README.md`; with
`CLEARPATH_COOL_MARKER` / `CLEARPATH_COOL_EXPECTED=1` in `/etc/clearpath/clearpath.env` the service reports
`verified_marker` only when the marker is actually found in the loaded OpenCV build.

## 3. Update the app

```bash
./package.sh                                  # re-uploads app/clearpath.tar.gz to the bucket in .state.env
aws ssm send-command --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript \
  --parameters 'commands=["set -e","aws s3 cp s3://'"$BUCKET"'/app/clearpath.tar.gz /tmp/c.tgz","tar -xzf /tmp/c.tgz -C /opt/clearpath","/opt/clearpath/venv/bin/pip install -q -r /opt/clearpath/backend/requirements.txt","chown -R clearpath:clearpath /opt/clearpath/backend/footage","systemctl restart clearpath-vision clearpath-api"]'
```

## 4. Teardown

```bash
./teardown.sh               # asks for confirmation; deletes instance, SG, role/profile, bucket + objects
./teardown.sh --keep-bucket # keep run archives in S3
```

CloudWatch custom metrics cannot be deleted; they stop costing once no new datapoints arrive and expire on their
own.

## Splitting vision onto its own instance

The vision service is self-contained (`backend/requirements-vision.txt`). To run it on a second Graviton
instance: start `clearpath-vision.service` there with `--host 0.0.0.0` and `VISION_API_KEY=<random>`, allow
TCP 8100 only from the API instance's security group, and on the API instance set
`VISION_SERVICE_URL=http://<vision-private-ip>:8100` and the same `VISION_API_KEY`. Clips missing locally are
fetched from `s3://<bucket>/footage/` (the instance role allows `footage/*`).

## Files

| file | purpose |
|---|---|
| `provision.sh` | create bucket, IAM, SG, upload bundle, launch instance; writes `.state.env` |
| `package.sh` | build `clearpath.tar.gz` (requires `frontend/dist`), upload to `s3://<bucket>/app/` (`--local-only` to just build) |
| `user-data.sh` | first-boot bootstrap (rendered with bucket/region by `provision.sh`) |
| `clearpath-vision.service`, `clearpath-api.service` | systemd units (loopback only, hardened, `StateDirectory=clearpath`) |
| `nginx.conf` | :80 -> API; read-only `GET /v1/health` -> vision service |
| `iam-policy.json`, `trust-policy.json` | instance role policies (`__BUCKET__` substituted at provision time) |
| `verify.sh` | health, Graviton proof, scenario run, CloudWatch, S3 checks |
| `teardown.sh` | delete everything recorded in `.state.env` |

Not done here: HTTPS (port 80 is limited to one CIDR; for a public demo put CloudFront or an ALB with an ACM
certificate in front), autoscaling, and persistence of in-progress runs across API restarts.
