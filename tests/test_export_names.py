import pytest
from backend.app.export_names import json_filename

@pytest.mark.parametrize('name,expected', [('hello','hello.json'),('hello.JSON','hello.json'),('../../bad:name','_.._bad_name.json'),('CON','_CON.json'),('', 'annotations.json'),('my video.json','my video.json')])
def test_json_names_are_portable(name,expected):
    assert json_filename(name)==expected

from fastapi.testclient import TestClient
from backend.app import db,review_delivery as review
from backend.app.formats import export_project
from backend.app.main import app
from backend.app.video import new_job
from pathlib import Path
from test_review_delivery import reviewed_project


def test_named_json_download_and_preflight_errors(reviewed_project):
    pid,vid,_,_=reviewed_project
    report=review.validate_annotations(vid,0,True,'selected_people');assert report['passed']
    settings={'format':'annotations_json','video_id':vid,'revision':0,'validation_id':report['validation_id']}
    job=new_job(pid,'export');export_project(pid,settings,job['id']);result=db.job_get(job['id']);assert result['status']=='completed'
    url='/api/exports/'+result['export_id']
    with TestClient(app) as client:
        assert client.get(url+'/check').json()['ready']
        response=client.get(url);assert response.status_code==200 and 'vfr.json' in response.headers['content-disposition']
        response=client.get(url,params={'filename':'Team annotation.json'})
        assert 'Team%20annotation.json' in response.headers['content-disposition'] and response.json()['format']=='frameinsight.annotations'
        # Removed exports are reported as actionable app errors, not successful downloads.
        with db.connect() as c:
            import json
            path=Path(json.loads(c.execute('SELECT data FROM exports WHERE id=?',(result['export_id'],)).fetchone()['data'])['path'])
        path.unlink()
        error=client.get(url+'/check');assert error.status_code==422 and 'missing' in error.json()['detail']
