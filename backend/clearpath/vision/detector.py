"""Object detection with the OpenCV 5 DNN module.

Model: YOLOX-S (COCO-80) from the OpenCV Model Zoo (Apache-2.0), loaded with cv.dnn.readNet.
Firearms are NOT a COCO class. CLEARPATH therefore never reports a firearm from this model;
it only reports COCO classes that may be weapon-like (knife, baseball bat, scissors) as
low-specificity cues that always require human verification. An optional dedicated weapon
model can be plugged in via WEAPON_MODEL (ONNX, YOLOX-style head); if absent the capability
is reported as unavailable rather than simulated.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from pathlib import Path

import cv2 as cv
import numpy as np

COCO_CLASSES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
    "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
    "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
    "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
    "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
    "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
    "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
    "hair drier", "toothbrush",
]
WEAPON_LIKE_COCO = {"knife", "baseball bat", "scissors"}


@dataclass
class Detection:
    cls: str
    score: float
    box: tuple[int, int, int, int]  # x, y, w, h in source pixels
    source: str  # model identifier

    def to_dict(self) -> dict:
        return {"cls": self.cls, "score": round(self.score, 3), "box": list(self.box), "source": self.source}


class YoloxDetector:
    """YOLOX decoder following the OpenCV Model Zoo reference implementation."""

    def __init__(self, model_path: Path, input_size: int = 640, conf: float = 0.35, nms: float = 0.5,
                 classes: list[str] | None = None, name: str = "yolox_s_coco", threads: int = 0):
        if not Path(model_path).exists():
            raise FileNotFoundError(f"Detector model not found: {model_path}")
        self.model_path = Path(model_path)
        self.net = cv.dnn.readNet(str(model_path))
        if threads > 0:
            cv.setNumThreads(threads)
        self.size = input_size
        self.conf = conf
        self.nms = nms
        self.classes = classes or COCO_CLASSES
        self.name = name
        self._lock = threading.Lock()
        self._out_names = self.net.getUnconnectedOutLayersNames()
        grids, strides = [], []
        for s in (8, 16, 32):
            n = input_size // s
            xv, yv = np.meshgrid(np.arange(n), np.arange(n))
            g = np.stack((xv, yv), 2).reshape(-1, 2)
            grids.append(g)
            strides.append(np.full((g.shape[0], 1), s))
        self.grids = np.concatenate(grids).astype(np.float32)
        self.strides = np.concatenate(strides).astype(np.float32)

    def _letterbox(self, img: np.ndarray) -> tuple[np.ndarray, float]:
        h, w = img.shape[:2]
        r = min(self.size / h, self.size / w)
        pad = np.full((self.size, self.size, 3), 114, np.float32)
        resized = cv.resize(img, (int(w * r), int(h * r)), interpolation=cv.INTER_LINEAR)
        pad[: resized.shape[0], : resized.shape[1]] = resized
        return pad, r

    def detect(self, img: np.ndarray, conf: float | None = None) -> tuple[list[Detection], float]:
        conf = self.conf if conf is None else conf
        pad, r = self._letterbox(img)
        blob = pad.transpose(2, 0, 1)[None]
        t0 = time.perf_counter()
        with self._lock:
            self.net.setInput(blob)
            out = self.net.forward(self._out_names)
        infer_ms = (time.perf_counter() - t0) * 1000
        d = out[0][0].copy()
        d[:, :2] = (d[:, :2] + self.grids) * self.strides
        d[:, 2:4] = np.exp(d[:, 2:4]) * self.strides
        scores = d[:, 4:5] * d[:, 5:]
        best = scores.max(1)
        idx = scores.argmax(1)
        m = best >= conf
        if not np.any(m):
            return [], infer_ms
        b = d[m, :4]
        xywh = np.stack([b[:, 0] - b[:, 2] / 2, b[:, 1] - b[:, 3] / 2, b[:, 2], b[:, 3]], 1) / r
        keep = cv.dnn.NMSBoxesBatched(xywh.tolist(), best[m].tolist(), idx[m].tolist(), conf, self.nms)
        dets = []
        H, W = img.shape[:2]
        for k in np.array(keep).reshape(-1):
            x, y, w, h = xywh[k]
            x0, y0 = max(0, int(x)), max(0, int(y))
            w, h = int(min(W - x0, w)), int(min(H - y0, h))
            if w <= 2 or h <= 2:
                continue
            dets.append(Detection(self.classes[int(idx[m][k])], float(best[m][k]), (x0, y0, w, h), self.name))
        return dets, infer_ms


_detector: YoloxDetector | None = None
_weapon: YoloxDetector | None | bool = None
_dlock = threading.Lock()


def get_detector() -> YoloxDetector:
    global _detector
    from ..config import settings
    with _dlock:
        if _detector is None:
            _detector = YoloxDetector(settings.detector_model, conf=settings.detector_conf, threads=settings.dnn_threads)
        return _detector


def get_weapon_detector() -> YoloxDetector | None:
    """Optional dedicated weapon model. Returns None when not configured (capability unavailable)."""
    global _weapon
    from ..config import settings
    with _dlock:
        if _weapon is None:
            p = settings.weapon_model
            if p and p.exists():
                labels_file = p.with_suffix(".labels.txt")
                labels = labels_file.read_text().split() if labels_file.exists() else ["weapon"]
                _weapon = YoloxDetector(p, classes=labels, name=f"weapon:{p.stem}", conf=0.5)
            else:
                _weapon = False
        return _weapon or None
