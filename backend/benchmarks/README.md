# CLEARPATH OpenCV benchmarks (stock OpenCV vs. COOL on AWS Graviton)

**Status: no COOL numbers exist yet.** The only result in `results/` is a stock OpenCV 5.0.0 run on the x86_64
development box (`stock-x86-dev-*`). Do not quote a COOL speedup until the protocol below has been run end to end
and `compare.py` prints a table without a "NOT COMPARABLE" block.

COOL (Cloud-Optimized OpenCV Library) is a performance-tuned OpenCV build for AWS Graviton, distributed through
AWS Marketplace (linked from <https://opencv.org/COOL/>, seller `seller-q3au5rsqt2mq6`). Its stated optimised
operations include resize, adaptive Gaussian thresholding and contour detection. We have not had access to it in
development, so this directory contains a harness to measure it honestly, not results.

## What the harness measures

`bench_opencv.py` first records the runtime identity, then times workloads on frames decoded from our footage
(768x576 clips from `backend/footage/`):

| identity field | why |
|---|---|
| `opencv_version`, `cv2_file` | which cv2 module was actually imported |
| `build_info_sha256` (+ parsed build fields) | fingerprint of `cv.getBuildInformation()`; differs between stock and COOL builds |
| `cool.state` | `verified_marker` only if `CLEARPATH_COOL_MARKER` is found in the loaded build info / module path |
| `machine`, `cpu` (model name, or ARM implementer/part -> Neoverse core) | proves the CPU actually used |
| `ec2` (IMDSv2: instance type, id, region, AZ, AMI) | proves the instance type; `null` off EC2 |
| `num_threads`, `use_optimized`, `loadavg` | things that silently change results |

Workloads (median / p90 / min / mean per call; warmup + N repeats; fast ops are batched so each sample lasts >= 2 ms):

* **micro**: `resize` 768x576 -> 384x288 and -> 1920x1440 (INTER_LINEAR, INTER_AREA), `adaptiveThreshold`
  (GAUSSIAN, block 11, C 2), `Canny`, `findContours` on Canny edges, `GaussianBlur` 15x15, `cvtColor` BGR2LAB,
  CLAHE, Farneback flow on 384x288 (the pipeline's parameters), MOG2 `apply` (steady state)
* **dnn**: YOLOX-S 640x640 `cv.dnn` forward pass only (model sha256 recorded)
* **e2e**: `clearpath.vision.pipeline.analyze_video` on `normal_a`, `flight_left_a`, `smoke_normal`
  (`include_frames=False`): wall time, frames/s, per-stage timings (decode, quality, enhance, bgsub, flow, detect)

Output: `results/<label>-<machine>-<UTC timestamp>.json`.

```bash
cd backend
python benchmarks/bench_opencv.py --label stock-x86-dev --repeats 15 --e2e-repeats 2   # what was run here
python benchmarks/compare.py results/A.json results/B.json                              # markdown table
```

`compare.py` prints `baseline_ms / candidate_ms` per workload (>1 = candidate faster). It **refuses** (exit 2)
when CPU architecture, EC2 instance type or CPU model differ, or when a candidate labelled `cool*` does not have
`cool.state == verified_marker`; `--force` prints anyway under a warning. It also notes when both files used the
identical OpenCV build (then the table is run-to-run noise, not stock vs COOL).

## Protocol: verifying COOL on Graviton

Use one Graviton instance type for every run (e.g. `c7g.xlarge`; the deploy kit in `deploy/aws/` launches one).
Stop the CLEARPATH services during measurements so they do not compete for CPU:
`sudo systemctl stop clearpath-api clearpath-vision`.

1. **Baseline on Graviton (stock OpenCV).** On the instance, in the app venv (stock `opencv-python-headless`
   5.0.0.93 from `requirements-vision.txt`):
   ```bash
   cd /opt/clearpath/backend
   python -c "import cv2; print(cv2.getBuildInformation())" > /tmp/stock-buildinfo.txt
   python benchmarks/bench_opencv.py --label stock-graviton --repeats 30 --e2e-repeats 3
   ```
   Check the JSON: `identity.machine == "aarch64"`, `identity.ec2.instance_type` is your instance type.

2. **Obtain COOL.** Subscribe through the COOL listing on AWS Marketplace (from <https://opencv.org/COOL/>) and
   follow the listing's own usage instructions. We do not know its exact packaging; handle it as follows:
   * **Python-loadable `cv2`** (wheel, or a build that ships a `cv2` package / `cv2*.so`): create a *separate*
     venv without `opencv-python-headless`, install the rest of `requirements-vision.txt`, then install the COOL
     package or point `PYTHONPATH` at the directory that contains COOL's `cv2`. Confirm with
     `python -c "import cv2; print(cv2.__file__, cv2.__version__)"` that the COOL module is the one imported.
   * **Delivered as an AMI**: launch it on the **same instance type**. Because the OS image then differs too, also
     run step 1 on that AMI (stock wheel in a separate venv) and compare against that baseline, so that only the
     OpenCV build differs.
   * **C++ library only** (headers + `libopencv_*.so`, no Python binding): the CLEARPATH Python pipeline cannot use
     it, and `bench_opencv.py` cannot measure it. Future work: a small C++ program that links the COOL libraries
     and times the same micro ops (same input frames written out as PNG, same sizes/parameters, same
     warmup/repeat/median protocol), built once against stock OpenCV 5.0.0 and once against COOL. Until that
     exists, no COOL number can be reported for CLEARPATH.

3. **Pick a COOL marker.** Find a string that appears in COOL's build information (or module path) and not in the
   stock one:
   ```bash
   python -c "import cv2; print(cv2.getBuildInformation())" > /tmp/cool-buildinfo.txt   # in the COOL venv
   diff /tmp/stock-buildinfo.txt /tmp/cool-buildinfo.txt
   export CLEARPATH_COOL_MARKER='<string present only in the COOL build info>'
   grep -qiF "$CLEARPATH_COOL_MARKER" /tmp/stock-buildinfo.txt && echo "NOT UNIQUE - pick another"
   export CLEARPATH_COOL_EXPECTED=1
   ```
   With these set, the vision service's `/v1/health` reports `runtime.cool.state = "verified_marker"`; if the
   marker is missing from the loaded build it reports `expected_not_verified` (never a silent claim).

4. **Run the COOL benchmark** on the same instance type, same repeats:
   ```bash
   python benchmarks/bench_opencv.py --label cool-graviton --repeats 30 --e2e-repeats 3
   ```
   Check `identity.cool.state == "verified_marker"` and that `identity.build_info_sha256` differs from the
   stock-graviton file.

5. **Compare.**
   ```bash
   python benchmarks/compare.py results/stock-graviton-aarch64-*.json results/cool-graviton-aarch64-*.json
   ```
   Publish both JSON files together with the table. Optionally also run the full service with COOL
   (`/v1/health` -> `cool.state`, CloudWatch metrics are tagged with the dimension `COOL=<state>`).

Optional cross-architecture context (not a COOL claim): `compare.py --force results/stock-x86-*.json
results/stock-graviton-*.json` shows stock x86 vs stock Graviton; the tool marks it as not comparable.

## Measured so far (stock only)

`results/stock-x86-dev-x86_64-20261025T081618Z.json` - OpenCV 5.0.0 (`opencv-python` 5.0.0.93 wheel),
Python 3.13, x86_64 "Intel Xeon Processor @ 2.80GHz", 2 vCPU, 2 OpenCV threads, not on EC2 (development
container; a dev API server was running alongside, so treat as indicative):

| workload | median |
|---|---:|
| resize 768x576 -> 384x288 INTER_AREA | 0.25 ms |
| resize 768x576 -> 1920x1440 INTER_LINEAR | 3.51 ms |
| adaptiveThreshold Gaussian 11/2 | 1.13 ms |
| findContours on Canny edges | 2.68 ms |
| Farneback flow 384x288 | 27.3 ms |
| YOLOX-S forward 640x640 | 323 ms |
| analyze_video (40 frames, 10 DNN inferences) | ~4.6 s (~8.6 frames/s) |
