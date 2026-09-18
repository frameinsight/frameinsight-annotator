FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN dpkg --add-architecture i386 && apt-get update && apt-get install -y --no-install-recommends \
    nsis gcc-mingw-w64-x86-64 wine64 wine32:i386 xvfb xauth ca-certificates python3 unzip fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
ENV WINEDEBUG=-all WINEPREFIX=/tmp/frameinsight-wine
WORKDIR /build
