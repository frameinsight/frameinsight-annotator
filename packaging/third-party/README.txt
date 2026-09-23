FRAMEINSIGHT THIRD-PARTY VIDEO LIBRARY SOURCES

Frameinsight application code is under the MIT license in LICENSE. That does
not replace the licenses of bundled Python, JavaScript, video or codec code.
The PyAV 18.1.0 wheels include FFmpeg 8.1.2 built with GPL components, including
x264 and x265. The FFmpeg libraries are distributed under GPL version 3 or later;
other components retain their individual licenses. There is no restriction on
replacing the bundled libraries or rebuilding the application from its source.

The matching release asset is:
  frameinsight-<app-version>-third-party-sources.tar.gz
Available beside the installer and Debian package at:
  https://github.com/frameinsight/frameinsight-annotator/releases

This source bundle contains unmodified source archives for PyAV, FFmpeg and
its enabled dependencies, plus PyAV's exact FFmpeg build recipes and patches.
The upstream vendor recipe tag is 8.1.2-1, commit
  a71bf9279f7a4659154b68ba6783e89be460bcd5
PyAV v18.1.0 scripts/ffmpeg-latest.json selects that vendor release.
The source archive checksums in sources.json come from its scripts/pkg.py;
PyAV's checksum comes from its published PyPI sdist. Windows libiconv is 1.19
as recorded by the DLL's _libiconv_version export. All downloaded archives are
hash-checked. Build instructions and platform configurations are included in
pyav-ffmpeg's scripts and .github/workflows directories; PyAV's own source
archive supplies the wheel build configuration. Frameinsight does not modify
these upstream source files. See upstream licenses inside each archive.

Frameinsight's release tag contains its complete application and packaging
source, including frontend lockfile, Windows wheel requirements and Debian
PyInstaller instructions. Both installed packages also carry application
source and dependency notices. GCC runtime libraries use the GCC Runtime
Library Exception; upstream toolchain information is available at
https://www.msys2.org/ and https://gcc.gnu.org/onlinedocs/libstdc++/manual/license.html

Sources and provenance:
https://github.com/PyAV-Org/PyAV/tree/v18.1.0
https://github.com/PyAV-Org/pyav-ffmpeg/tree/a71bf9279f7a4659154b68ba6783e89be460bcd5
https://ffmpeg.org/legal.html
https://www.gnu.org/software/libiconv/
