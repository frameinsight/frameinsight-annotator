"""Exact frame delivery stays independent across concurrent camera viewers."""
import io
import json
import uuid
from concurrent.futures import ThreadPoolExecutor

import av
from fastapi.testclient import TestClient
from PIL import Image

from backend.app import db, main, video


def test_parallel_camera_frames_remain_exact_and_missing_frame_can_recover(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB', tmp_path / 'frames.sqlite3')
    monkeypatch.setattr(main, 'DATA', tmp_path)
    monkeypatch.setattr(video, 'DATA', tmp_path)
    (tmp_path / 'frames').mkdir()
    db.init()
    pid = str(uuid.uuid4())
    with db.transaction() as connection:
        connection.execute('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)',
                           (pid, 'Concurrent cameras', db.now()))

    recordings = []
    for camera in range(4):
        vid = str(uuid.uuid4())
        source = tmp_path / f'camera-{camera}.mkv'
        with av.open(str(source), 'w') as container:
            stream = container.add_stream('ffv1', rate=25)
            stream.width, stream.height, stream.pix_fmt = 48, 32, 'bgr0'
            for frame_index in range(8):
                image = Image.new('RGB', (48, 32), (camera * 60, frame_index * 30, 90))
                for packet in stream.encode(av.VideoFrame.from_image(image)):
                    container.mux(packet)
            for packet in stream.encode():
                container.mux(packet)
        with db.transaction() as connection:
            record = {'id': vid, 'project_id': pid, 'status': 'indexing', 'frame_count': 0}
            connection.execute('INSERT INTO videos VALUES(?,?,?)', (vid, pid, json.dumps(record)))
        recordings.append((camera, vid, source))

    # Same index concurrency as the app: separate containers and per-video caches.
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = []
        for _, vid, source in recordings:
            job = video.new_job(pid, 'index', video_id=vid)
            futures.append((job['id'], pool.submit(video.index_video, vid, source,
                                                   tmp_path / f'{vid}.mkv', job['id'])))
        for jid, future in futures:
            future.result()
            assert db.job_get(jid)['status'] == 'completed'

    with TestClient(main.app) as client:
        def fetch(key):
            camera, vid, frame_index = key
            response = client.get(f'/api/videos/{vid}/frames/{frame_index}')
            assert response.status_code == 200
            assert response.headers['x-frame-key'] == f'{vid}:{frame_index}'
            with Image.open(io.BytesIO(response.content)) as image:
                assert image.size == (48, 32)
                assert image.getpixel((24, 16)) == (camera * 60, frame_index * 30, 90)

        requests = [(camera, vid, frame) for _ in range(4)
                    for camera, vid, _ in recordings for frame in range(8)]
        with ThreadPoolExecutor(max_workers=12) as pool:
            list(pool.map(fetch, requests))

        camera, vid, _ = recordings[2]
        path = tmp_path / 'frames' / vid / '00000003.png'
        contents = path.read_bytes()
        path.unlink()
        missing = client.get(f'/api/videos/{vid}/frames/3')
        assert missing.status_code == 404
        assert 'missing' in missing.json()['detail']
        # A missing cache frame must not poison another camera or future retries.
        fetch((recordings[0][0], recordings[0][1], 3))
        path.write_bytes(contents)
        fetch((camera, vid, 3))
        assert client.get(f'/api/videos/{vid}/frames/8').status_code == 404
