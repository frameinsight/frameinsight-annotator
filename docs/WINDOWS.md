# Windows installation

Give the annotator the **3.0.0** `Window_setup.exe` and `START-HERE.txt` from the
[official release](https://github.com/frameinsight/frameinsight-annotator/releases/latest).
Double-click the installer, follow its pages, then use the desktop shortcut.
Windows 11, **64-bit**, is the release target. Edge or Chrome is sufficient.
Python, Node, models and GPU setup are not required. The app runs locally and
opens in the default browser. Annotation works offline; checking for and
downloading updates requires internet. This is an unsigned installer, so
Windows may identify its publisher as unknown.

Installation is per user, without administrator rights. It includes the Python
runtime, CPU video decoding, annotation UI and editable interpolation. The app
starts with a video library, asks for named classes before upload, and includes
an optional beginner walkthrough. Any number of class boxes can share one
object track. Finish creates the full annotated review video, lets the annotator
confirm coverage, runs structural validation, and prepares annotations-only
JSON. Changes made after review require a fresh review and validation.
No user videos, annotations, projects, model weights or test fixtures are
included in the installer.

Closing the browser leaves the local server running. Use the tray icon near
the clock to reopen the editor, open the data folder, or exit after saving.
Starting another copy reopens the existing editor. Port 8765 must be available.

| Item | Location |
|---|---|
| Application | `%LOCALAPPDATA%\Programs\Frameinsight` |
| Saved work | `%LOCALAPPDATA%\Frameinsight\Data` |
| Log | `%LOCALAPPDATA%\Frameinsight\Logs\server.log` |

Updates and uninstalling preserve the data directory. Back it up while the
app is closed, or keep native project archives together with source videos.
Annotations JSON exports contain no video/images and are not a restore format.
The app retains imported videos and decoded frame caches locally to support
exact-frame editing. Leave sufficient disk space for these files.

# Updates

The update notice checks the public GitHub release version. **Download update**
downloads the installer and verifies its published size and SHA-256 checksum.
**Install update** closes Frameinsight and opens the normal installer; complete
its pages, then reopen the app. Save first. Nothing installs merely because an
update is available. A failed check leaves offline annotation available.

You can also close Frameinsight from its tray icon and install a newer official
`Window_setup.exe` yourself. The installer refuses to replace a running app.

# Building from Ubuntu

Install frontend dependencies with `npm --prefix frontend ci`, use the project
Python virtual environment, and run `packaging/windows/build.sh`. Docker builds
MinGW and NSIS tools in an isolated image; no host package installation is
needed. The script downloads pinned Windows wheels and official embedded
Python 3.13.12, verifies the Python archive SHA256, builds the frontend, prepares
an allowlisted payload, compiles the native launcher and builds the installer.
Dependency hashes and notices ship inside the installed app. Build products
are in `.frameinsight/windows-build`; deliverables are in `deliverables/windows`.

# Building natively on Windows

Use Python 3.13.12, Node 22, the MSYS2 UCRT64 compiler and NSIS 3.11. Run
`npm --prefix frontend ci`, then `packaging/windows/build.ps1` in PowerShell 7.
The script bundles the same official embedded runtime and pinned wheels.
The [desktop release workflow](../.github/workflows/desktop-release.yml) performs
this build on a Windows runner, exercises the installed app, and publishes only
when both the Windows and Debian checks pass. See [release maintenance](RELEASES.md).

# Verification and limitations

Local packaging checks use Wine in an isolated container. CI is configured to
run the installed runtime on its Windows Server runner. The synthetic-video
suite exercises imports, frame decoding, multiple classes sharing a track,
persistence, full annotated MP4 rendering with exact source timing,
review/validation guards, JSON export, graceful exit, relaunch, upgrade,
shortcuts and preservation of data during uninstall.

**Neither environment substitutes for a test on an actual Windows 11 laptop.**
SmartScreen, antivirus behavior, the native browser picker and performance on
the recipient's hardware remain to be checked there. Consult the release's
machine-readable verification reports for the checks actually completed.
