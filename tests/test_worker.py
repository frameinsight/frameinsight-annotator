from backend.app.worker import proposal_identifier

def test_identical_source_imports_do_not_steal_each_others_proposals():
    a=proposal_identifier('video-a','same-source-and-model',0,0)
    b=proposal_identifier('video-b','same-source-and-model',0,0)
    assert a != b
    assert a == proposal_identifier('video-a','same-source-and-model',0,0)
    assert a != proposal_identifier('video-a','different-settings',0,0)
