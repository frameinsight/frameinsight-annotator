# Desktop releases and updates

The public download location is [GitHub Releases](https://github.com/frameinsight/frameinsight-annotator/releases). Each stable version contains:

- `Window_setup.exe`: Windows 11 x64 installer.
- `frameinsight_VERSION_amd64.deb`: Ubuntu 24.04+/Debian 12+ desktop package.
- `release-manifest.json`: updater metadata with the version, platform, exact filename, byte size and SHA-256 of each installer.
- `SHA256SUMS.txt`: installer and manifest checksums.
- `frameinsight-VERSION-third-party-sources.tar.gz`: matching PyAV/FFmpeg/codec sources, patches and build recipes.
- Separate Windows/Linux start instructions and packaged-runtime verification reports.

Both packages include the MIT application license and applicable third-party notices. Dependency licenses remain their own; the entire bundled runtime is not relicensed as MIT. No user footage, annotation database, generated review video, model weight or test fixture belongs in release assets.

PyAV's bundled FFmpeg is built with GPL components. The source archive is a required release companion, not an end-user installation step. `packaging/third-party/sources.json` records the exact upstream vendor recipe commit and source checksums; `packaging/third_party_sources.py` downloads and verifies every archive. Changing PyAV requires updating that catalog to the corresponding vendor release. See the installed `VIDEO-LIBRARY-SOURCES.txt` and the upstream [FFmpeg distribution guidance](https://ffmpeg.org/legal.html).

## Maintainer release workflow

1. Update the same stable `major.minor.patch` version in `frontend/package.json`, both root-version entries in `frontend/package-lock.json`, `frontend/src/release.ts`, and `backend/app/version.py`. Installer versions are generated from these values. `python packaging/release_manifest.py` rejects mismatches.
2. Commit the completed change, including installation/user documentation. Run the normal tests and inspect the browser on a small laptop viewport.
3. The **Desktop release** GitHub Actions workflow can be run manually on a branch with **Publish** left off. It builds candidate artifacts without publishing a release.
4. When the result is ready, create and push the matching version tag, such as `v3.0.0`, on the reviewed commit. Tag publication is the release authorization step.
5. The workflow checks versions; runs backend, frontend and Chrome acceptance tests; builds Windows on a Windows runner and Debian in the pinned Debian builder; collects corresponding library sources; and runs installed-runtime acceptance. Only after every job passes does it generate checksums and publish the versioned assets.

The repository must be public before the publishing job succeeds. The workflow checks that the version tag still points at the tested commit. Build jobs have read-only repository permissions; only the final publishing job has release-write permission. Actions are pinned by commit. Existing release assets are never overwritten: corrections require a new patch version. If publishing stops after creating a draft, inspect its completed assets and finish publishing that draft in GitHub; drafts do not reach startup update checks.

The native Windows runner verifies the packaged launcher, runtime and installer. This is stronger than Wine-only acceptance, but a Windows Server CI runner is still not a physical Windows 11 annotator laptop. Debian runtime checks run as an ordinary user in a disposable Debian container. The reports state the actual environment and do not claim physical-desktop GUI testing.

## Building locally

On Ubuntu, use `packaging/windows/build.sh` for the Windows cross-build and `packaging/debian/build.sh` for the self-contained `.deb`. Docker keeps compiler/runtime build dependencies separate from the host. Generated files stay under `.frameinsight/` and `deliverables/`.

On Windows, install the developer build tools (Python 3.13, Node, NSIS 3.11 and MSYS2 UCRT64 GCC), install the pinned requirements and frontend dependencies, then run `packaging/windows/build.ps1`. End users need none of these tools. GitHub Actions performs these steps automatically.

`packaging/debian/test-installed.sh` installs and removes the Linux package. Run it only in a disposable container with `FRAMEINSIGHT_DISPOSABLE_TEST=1`; the script refuses to run without this explicit test marker. It verifies startup, one server per user session, three independent classes sharing one track, annotation-only structural validation/export without rendering, stale-export rejection after settings edits, legacy review-render compatibility, restart persistence, running-app guards, and preservation of user data through reinstall and purge.

To prepare a release manifest locally, put only the chosen version's installers and delivery documents in a clean directory, then run:

```bash
python packaging/third_party_sources.py --directory PATH_TO_RELEASE_ASSETS
python packaging/release_manifest.py --tag v3.0.0 --directory PATH_TO_RELEASE_ASSETS
```

Do not rename the Windows asset or change the versioned Debian filename after manifest generation. Upload the manifest and checksum file together with both installers and the source archive. The updater verifies the exact platform asset before offering installation.

## Update behavior

The app checks the official public release repository at startup. Offline or unavailable release checks do not block annotation. A download needs an explicit user action; installation needs a separate explicit action after saving. Video import, rendering and export jobs must finish first.

Windows closes the local server and desktop launcher before opening the verified installer, so the single-instance mutex is released. Debian closes its bundled server and opens an available supported system package installer; its usual administrator prompt handles installation permission. No password is collected by Frameinsight. If an installer is unavailable, the verified package remains available for manual installation. Updating or uninstalling never deletes the per-user data directory.
