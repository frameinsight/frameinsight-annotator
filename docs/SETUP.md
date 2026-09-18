# Local setup and operations

The tested machine is Ubuntu 26.04, Python 3.13.2, Node 20.19.5, and a GTX 1650 with 4 GB VRAM. Exact installed package versions and CUDA diagnostics are in `machine-diagnostics.json`. Python application dependencies are pinned in `requirements.txt`; frontend packages and transitive dependencies are pinned by `frontend/package-lock.json`.

Run `scripts/setup.sh` for a clean manual-editor installation. The current workspace's `.venv` was created with `--system-site-packages` to reuse the user's existing trusted PyTorch and Ultralytics installation. Do not remove it merely to install GPU dependencies again. GPU packages are optional; their tested versions are recorded in `requirements-gpu-tested.txt`. This environment's PyTorch runtime reports CUDA 13.0 and includes `sm_75`; an actual GPU tensor operation was tested. Do not assume an arbitrary replacement PyTorch wheel supports this GPU. No driver changes are necessary here.

Run `.venv/bin/python scripts/diagnostics.py` for package, OS, GPU memory, runtime and device diagnostics. The app also has a diagnostics dialog. The detector dialog explicitly selects GPU or CPU, resolution, candidate threshold and class mapping. It loads only `.pt` files inside the trusted model directory. The supplied model has one `person` class: its confirmed mapping proposes A only. It cannot determine B or identity. Existing model license and training-data restrictions remain in `models/README.md`.

## Run and stop

`./scripts/start.sh` runs one Uvicorn process on `127.0.0.1:8765`. It serves the built React app and API together. Use `./scripts/start-background.sh` for a user systemd service (transient by default); `./scripts/stop.sh` stops that service. `journalctl --user -u frameinsight` shows background logs. To opt into startup at login, finish current jobs, stop the service, then run `./scripts/install-service.sh`. To disable login startup later, use `systemctl --user disable frameinsight.service`. In development run `npm run dev` in `frontend/`; its proxy reaches the same local API. Rebuild with `npm run build` after frontend changes; restart the server after backend changes.

Localhost binding, host validation, and restricted request origins are enforced. Remote/network operation is deliberately not exposed; authentication and explicit origin configuration must be implemented before enabling remote access. No telemetry or cloud uploads are present. The browser has no external font/CDN dependency.

## Data and recovery

Defaults are under `.frameinsight/`: the SQLite database, immutable original copies, lossless frame cache, exports and consistent database backups. `FRAMEINSIGHT_DATA`, `FRAMEINSIGHT_WORKSPACE`, and `FRAMEINSIGHT_MODELS` override these roots. Set them before starting the service. `config.example.yaml` documents defaults; it is not parsed as a second configuration source.

Each operation is written to IndexedDB before sending. `Saved` means a server acknowledgment, `Saved locally` means queued in the browser, and `Save failed` means a failed request or storage write. A failed save remains queued. Retry after restoring connectivity. Revision conflicts never auto-overwrite another tab's work. Download the recovery copy before changing anything when there is a conflict. Only one active editing tab is supported per project.

Undo and redo are new compensating operations. The original operations remain in SQLite; the browser retains the latest 200 undo entries. Pointer gestures do not hit the server until release or explicit F/D navigation commits the gesture. Escape cancels the uncommitted gesture.

Use Export → Create database backup for SQLite's consistent online backup. A raw live database file copy is not the documented backup method. Native archive export optionally includes originals. To restore, open the project chooser and upload a native ZIP. The importer verifies source hashes and redecodes timestamps; missing or changed sources fail explicitly. Restore creates a new project and preserves historical operations as imported history, not executable undo entries.

An interrupted indexing pass can be retried from Diagnostics. Decoded frames already on disk remain usable. A stopped/crashed detector never removes annotations or existing proposals. Queued/running jobs interrupted by app restart are marked failed, with restart instructions.

## Storage and performance tradeoffs

Lossless PNG frames preserve decoded pixels and remove unreliable timestamp seeking. They consume substantially more disk than source video and can take minutes to index noisy, high-resolution CCTV. Indexing is progressive: frame 0 becomes editable before the entire clip is ready. The browser caches at most 15 decoded images and prefetches nearby frames; memory use grows with source resolution. This first implementation loads project annotations into the client; very large projects may need observation paging in a later release.
