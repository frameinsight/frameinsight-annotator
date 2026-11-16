"""Status polling must not decode annotation state from large projects."""
import json
import pytest
from backend.app import db


def test_status_reads_only_revision_and_videos(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB', tmp_path / 'status.sqlite3')
    db.init()
    with db.transaction() as c:
        c.execute('INSERT INTO projects(id,name,created_at,revision) VALUES(?,?,?,?)', ('p', 'Status', db.now(), 7))
        c.execute('INSERT INTO videos VALUES(?,?,?)', ('v', 'p', json.dumps({'id': 'v', 'status': 'ready'})))
        # Status must be independent of annotation JSON size or decoding.
        c.execute('INSERT INTO entities VALUES(?,?,?,?)', ('p', 'identities', 'i', 'not needed by status'))
    assert db.event_snapshot('p') == {'revision': 7, 'videos': {'v': {'id': 'v', 'status': 'ready'}}}
    with pytest.raises(KeyError, match='Project not found'):
        db.event_snapshot('missing')
