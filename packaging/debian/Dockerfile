FROM python:3.13.12-slim-bookworm@sha256:3121f8b0804aa3698ab750d9a39ea4a42657a385c9b133722b915e55c51551a6
RUN apt-get update && apt-get install -y --no-install-recommends \
    binutils dpkg-dev gcc libc6-dev libglib2.0-0 libgl1 libx11-6 libxext6 libxcb1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements /requirements
RUN python -m pip install --no-cache-dir -r /requirements/debian/requirements-build.txt
ENV PYTHONDONTWRITEBYTECODE=1 PYINSTALLER_CONFIG_DIR=/tmp/frameinsight-pyinstaller
WORKDIR /src
