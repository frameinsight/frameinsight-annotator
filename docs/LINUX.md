# Ubuntu and Debian desktop installation

Download `frameinsight_VERSION_amd64.deb` from the [official releases](https://github.com/frameinsight/frameinsight-annotator/releases). Open it with Software Install, GDebi, or your distribution's package installer, then choose **Install**. Launch **Frameinsight** from Applications. Its local browser interface opens automatically.

The package targets **Ubuntu 24.04+ and Debian 12+, Intel/AMD 64-bit**, with glibc 2.36 or newer and a graphical desktop. Python and the CPU video libraries are bundled. Node, Python setup, CUDA and AI models are not required. Standard desktop libraries and a graphical package installer may be installed by your package manager. GDebi is recommended for update handoff.

If your desktop opens `.deb` files as archives, use **Open With → Software Install/GDebi**, or run:

```bash
sudo apt install ./frameinsight_VERSION_amd64.deb
```

The app works offline. Update checks only contact the public release service; they do not upload videos or annotations. Updates are optional, verified against release checksums, and installed through the normal system installer after explicit confirmation. If no supported graphical installer is available, download the package and install it manually.

## Saved work and closing

Closing the browser leaves the local server running. Right-click **Frameinsight** in the Applications menu and choose **Close Frameinsight**, or run `frameinsight --stop`. Finish saving first. A running render may need to finish before the process exits.

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
