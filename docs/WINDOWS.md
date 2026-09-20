# Windows installation

Give the annotator `Window_setup.exe` and `START-HERE.txt`.
Double-click the installer, follow its pages, then use the desktop shortcut.
Windows 10 or 11, **64-bit**, is required. A normal browser such as Edge or
Chrome is sufficient. Python, Node, AI models and GPU setup are not required for manual annotation or JSON import.
The app runs locally and opens in the default browser. Internet is not needed
after installation. This is an unsigned installer, so Windows may identify its
publisher as unknown.

The installation is per user, without administrator rights. It includes the
Python runtime, CPU video decoding, annotation UI and editable interpolation.
The app starts with a video library, asks for classes before upload, shows a
right panel with AI assistance status, annotation import and a Shortcuts tab, and uses Save and Finish for completion. No user videos, annotations, projects,
model weights or test fixtures are included in the installer.

Closing the browser leaves the local server running. Use the tray icon near
the clock to reopen the editor, open the data folder, or exit after saving.
Starting another copy reopens the existing editor. Port 8765 must be available.

App: `%LOCALAPPDATA%\Programs\Frameinsight`

Saved work: `%LOCALAPPDATA%\Frameinsight\Data`

Log: `%LOCALAPPDATA%\Frameinsight\Logs\server.log`

Updates and uninstalling preserve the data directory. Back it up while the
app is closed, or keep native project archives together with source videos.
Annotations JSON exports contain no video/images. Import them through the right panel after loading the exact original video to continue editing; use a native backup to retain the original project history.
The app itself retains imported videos and decoded frame caches locally to
support exact-frame editing. Leave sufficient disk space for these files.

# AI processing

This installer does **not** bundle Torch, Ultralytics or model weights. It shows
AI as unavailable when those optional dependencies are absent. Manual editing,
interpolation and JSON import continue to work offline. For the intended split
workflow, run detection/tracking on the configured GPU computer, export annotation
JSON after selecting the tracks, and import it on this laptop with the same video.
The source application's GPU setup is documented in the README.

# Building from Ubuntu

Install frontend dependencies with `npm --prefix frontend ci`, use the project
Python virtual environment, and run `packaging/windows/build.sh`. Docker builds
MinGW and NSIS tools in an isolated image; no host package installation is
needed. The script downloads pinned Windows wheels and official embedded
Python 3.13.12, verifies the Python archive SHA256, builds the frontend, prepares
an allowlisted payload, compiles the native launcher and builds the installer.
Dependency hashes and notices ship inside the installed app. Build products
are in `.frameinsight/windows-build`; deliverables are in `deliverables/windows`.

# Verification and limitations

The editor has automated browser tests and manual Chrome verification on
Ubuntu. The bundled Windows runtime, native launcher and installer are tested
under Wine in an isolated container using a synthetic video. This exercises
imports, frame decoding, annotation persistence, JSON export, graceful exit,
relaunch, upgrade, shortcuts and preservation of data during uninstall.
**This does not substitute for a test on an actual Windows 11 laptop.**
No physical Windows machine was available for this build. SmartScreen,
Antivirus behavior, the native browser picker and performance on the recipient's
hardware remain to be checked there. See the machine-readable verification
reports in `deliverables/windows` for the checks actually completed.
