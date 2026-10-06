# Ubuntu and Debian desktop installation

Download `frameinsight_3.10.0_amd64.deb` and `START-HERE-LINUX.txt` from the [official releases](https://github.com/frameinsight/frameinsight-annotator/releases). Open the package with Software Install, GDebi, or your distribution's package installer, then choose **Install**. Launch **Frameinsight** from Applications. Its local browser interface opens automatically.

The package targets **Ubuntu 24.04+ and Debian 12+, Intel/AMD 64-bit**, with glibc 2.36 or newer and a graphical desktop. Python and the CPU video libraries are bundled. Node, Python setup, CUDA and AI models are not required. Standard desktop libraries and a graphical package installer may be installed by your package manager. Automatic updates use apt-get and pkexec, which is included as a package dependency. Your desktop provides the normal authorization prompt.

If your desktop opens `.deb` files as archives, use **Open With → Software Install/GDebi**, or run:

```bash
sudo apt install ./frameinsight_3.10.0_amd64.deb
```

The app works offline. On app startup, newer stable releases are downloaded, checksum-verified and installed automatically, then Frameinsight reopens. The desktop may ask for your administrator password through its standard authorization prompt; Frameinsight never receives that password. Update checks do not upload videos or annotations. Offline checks, failed downloads and cancelled authorization leave saved data intact and allow the current version to be reopened. Install 3.10.0 once to enable automatic updates for subsequent releases.

## Annotate, review and export

1. Choose **New project**, enter its name and classes, then add videos inside it.
   The project's video table shows progress, creation and update dates, and an
   **Open** or **Resume** action. The editor can import Frameinsight JSON, YOLO or MOT annotations.
2. Choose a class, press **N**, and draw a box around one object. Keep that track
   selected as you move through frames and adjust its box; interpolation fills
   between corrections. Check those frames and correct any inaccurate boxes.
   Several classes can share the same track ID. Work saves automatically.
3. Click **Finish**, then **Review in editor**. The existing canvas plays from
   frame 0 with all tracks and classes shown at 0.5×. Use slower playback or step
   through frames to check box placement and IDs; correct mistakes in the editor.
4. Click **Finish** again and choose **I reviewed — continue**. On **Validate &
   export**, choose annotation coverage and **Run annotation validation**.
5. After **Validation passed. You can export.**, choose **Prepare validated
   JSON**, then **Download annotations (.json)**.

Finish does not render another video. Validation checks saved data structure and
references; visual accuracy and real-world identity still need your review.
The JSON contains annotations only, with no video or images. **Project settings**
and **Edit classes** let you rename the project or classes during annotation;
**Edit project & classes** is also available before export. Run validation again
after changes to export the updated names. Use a native **Back up project** ZIP
and keep original videos separately when you need a restorable copy.

## Saved work and closing

Closing the browser leaves the local server running. Right-click **Frameinsight** in the Applications menu and choose **Close Frameinsight**, or run `frameinsight --stop`. Finish saving first. Background work may need to finish before the process exits.

| Location | Contents |
|---|---|
| `/opt/frameinsight` | Bundled application and Python runtime |
| `~/.local/share/frameinsight/data` | Projects, imported videos, cached frames and exports |
| `~/.local/state/frameinsight/server.log` | Application log |

Configured `XDG_DATA_HOME` and `XDG_STATE_HOME` replace the corresponding default parent folders. Data is private to the desktop user. Updating, removing, or purging the package does **not** delete these user folders. Package upgrades/removal refuse to replace a runtime that is still running; close the app and retry. Back up projects and original videos before changing computers.

Existing source-checkout projects are not moved automatically. Make a native project backup in the old app, close it, start the installed app, and use **Restore a backup**. The two apps use separate data folders and both normally use port 8765, so run one at a time.

## Building

Install Node dependencies using `npm --prefix frontend ci`, then run `packaging/debian/build.sh`. Docker builds in the official Python 3.13.12 Debian 12 environment, pins Python dependencies, and creates a PyInstaller directory bundle. Only the application source, built frontend, documentation, runtime and license notices enter the package. Source footage, databases, model weights and test media are excluded.

Build products are under `.frameinsight/debian-build`. The current `.deb`, checksum and installation instructions are copied to `deliverables/linux`. `--skip-frontend` reuses a frontend build that has already passed its checks. The GitHub release workflow builds and tests the same package in an isolated runner.

The Linux package is not an AppImage, Snap, system service or network server. It runs as the current desktop user and binds only to localhost. ARM, Ubuntu 22.04, Debian 11 and headless multi-user hosting are outside this package's supported target.

## In-app update troubleshooting

Version 3.9.0 stages the verified public installer outside private annotation folders before opening the system package manager. The frozen app and its helper exit before installation, so the running-app guard cannot block the helper itself. Installer stdout/stderr and its exit code are saved in `~/.local/share/frameinsight/data/updates/<version>/install-handoff.log` (or your configured XDG data location). Nonzero exits show the log and verified package path. Closing or cancelling a package-manager window does not mean the update was installed; reopen Frameinsight and check its version.

If an older installation cannot update itself, close Frameinsight using its application-menu close action (closing the browser tab alone does not stop the app), download the current `.deb` from the official release, and install it manually once. Saved projects remain in place. Future updates use the repaired handoff.

Automatic update failures are not retried automatically for one hour for the same installed/target version pair, preventing a restart loop. App updates still provides a manual retry. For isolated packaging tests or administrator-managed installations, `FRAMEINSIGHT_DISABLE_AUTO_UPDATE=1` disables startup installation. Source checkouts do not install updates automatically.
