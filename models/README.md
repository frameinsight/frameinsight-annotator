---
license: agpl-3.0
tags:
  - object-detection
  - person-detection
  - cctv
  - yolo26
  - ultralytics
library_name: ultralytics
---

# person-detector-yolo26m-cctv-v1

YOLO26-m fine-tuned for **person detection on CCTV footage** (retail / market /
indoor store cameras). Built with an auto-labeling pipeline: two large teacher
models (YOLO26-XLarge, RF-DETR-Large) label raw footage, cross-checked by
tracking persistence, CLIP crop verification, static-object suppression, and a
human review pass — no manual box annotation.

## Why it exists

Generic COCO-trained detectors underperform on CCTV: ceiling angles, fisheye
lenses, and people half-hidden behind shelves/counters get low confidence and
are lost. This model is fine-tuned on exactly that domain, including
occlusion-gap examples interpolated from tracks.

## Results (v1)

- Held-out CCTV camera (never trained on, 320x240 worst-case quality):
  **mAP50 0.664** (vs pseudo-label reference).
- Same held-out camera, recall at conf 0.30: **0.493** vs 0.463 (YOLO26-XLarge,
  6x larger) and 0.451 (RF-DETR-Large) — the fine-tuned small model finds more
  real people than its teachers on unseen CCTV.
- Detection-only, single class: `person`.

## Usage

```python
from ultralytics import YOLO
model = YOLO("student_yolo26m_20260815_0023_best.pt")
results = model.predict("frame.jpg", conf=0.4, imgsz=1280, classes=[0])
```

ONNX export (dynamic shapes, imgsz 1280) is included for TensorRT/DeepStream
deployment.

## Training data

- ~26k auto-labelled frames from 14 private CCTV cameras (Pakistan,
  Philippines, Japan; markets, stores, school), ~700k person boxes.
- CrowdHuman (visible-body boxes; research dataset — see licensing below).
- Roboflow Universe "human-cctv" (CC BY 4.0, project-d4kos).

## Licensing — read before commercial use

- Base model YOLO26 is **AGPL-3.0** (Ultralytics); these fine-tuned weights are
  a derivative and are published under AGPL-3.0. Closed-source commercial
  deployment requires an Ultralytics Enterprise License.
- CrowdHuman is licensed for **academic / non-commercial research**. This v1
  checkpoint is a research artifact; a commercial-clean retrain (without
  CrowdHuman) is planned.
- Roboflow "human-cctv" data requires attribution (CC BY 4.0) — credited above.

## Limitations

- Single-class person detector; no tracking or ReID included.
- Tuned for indoor/short-range CCTV; aerial or thermal imagery untested.
- v1 trained on 14 cameras — accuracy on radically different viewpoints will
  improve with future data rounds.
