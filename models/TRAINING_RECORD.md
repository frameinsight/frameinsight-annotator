# Training Record — person_detection v1

**Model:** frameinsight/person_detection (student_yolo26m_20260815_0023)
**Date:** trained 2026-08-15, published 2026-08-17
**Pipeline code:** github.com/frameinsight/person-detection (person-detector-training-pipeline/, commit at publish time)
**Dataset snapshot:** stored locally on vanila-server: /data/users/humza/cctv/detector-training/dataset (not published)

## Recipe

- Base: YOLO26-m COCO checkpoint (ultralytics 8.4.116, AGPL-3.0)
- imgsz 1280, batch 4, multi_scale OFF (8GB VRAM limit), AMP on,
  workers 2, epochs max 50 — stopped manually at 37 (plateau), best epoch 35
- Hardware: RTX 3070 Ti 8GB, ~85 min/epoch
- Full hyperparameters: config.yaml in the pipeline repo (this commit)

## Dataset composition (train: 36,601 images / 699,713 person boxes)

| Source | Images | Notes |
|---|---|---|
| Own CCTV, auto-labelled | 24,851 | 13 cameras: PK school/shops, PH markets (day+night), JP store (6h span), misc CCTV |
| CrowdHuman (vbox) | 10,000 | research license — NOT redistributed; fetch from sshao0516/CrowdHuman |
| Roboflow human-cctv v1 | 1,750 | CC BY 4.0, universe.roboflow.com/project-d4kos/human-cctv |

Validation: 705 frames from held-out camera `channel_23_supermarket_checkout`
(320x240) — never in training.

## Auto-label ladder (see pipeline README)

Teachers YOLO26-XLarge@1280 + RF-DETR-Large@1344 at conf 0.05 → accept via:
two-teacher agreement (IoU>=0.55) | single-teacher conf>=0.60 | ByteTrack
persistence >=1.2s | CLIP zero-shot >=0.75 (no-pad crops, negative prompts) |
track gap-interpolation <=1.5s (human-flagged). Static-box suppression for
posters/mannequins. Human review: 180 cards decided; CLIP band [0.70,0.80]
found ~58% fake -> undecided band boxes dropped (105 review-rejected boxes
excluded).

## Results

- Held-out cam: mAP50 0.664, mAP50-95 0.507 (vs pseudo-label reference)
- Recall @conf 0.30 vs teachers on held-out: student 0.493 > yolo26x 0.463 >
  rfdetr-L 0.451 (student TP 2214 vs 2081 / 2027)
- Test @conf 0.5, cctv_20min (seen): student 5.56 mean persons/frame vs
  yolo26x 3.34, rfdetr-L 3.65 — visually verified by Humza

## Known issues / notes for v2

- Precision below teachers vs pseudo-labels (0.768) — partly referee bias
  (teachers graded against own labels); verifier model planned for v2.
- CrowdHuman in diet => research-use artifact; v2 plan: Apache-2.0 base
  (commercially clean) + no CrowdHuman + review decisions + verifier.
- Incidents during training (documented in pipeline README "Server quirks"):
  polars SIGILL (no-AVX2 CPU), dataloader deadlock (workers=8/auto-batch),
  VRAM OOM at multi-scale peaks, GPU Xid 79 bus drop under sustained load.
