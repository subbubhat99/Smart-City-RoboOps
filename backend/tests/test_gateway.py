import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

CAMERA = '11111111-1111-4111-8111-111111111111'
PROMPT = '22222222-2222-4222-8222-222222222222'
SUMMARY = '33333333-3333-4333-8333-333333333333'


@pytest.fixture
def env(tmp_path):
    settings = Settings(database=str(tmp_path / 'state.sqlite3'), operator_token='operator',
                        camera_zones_path=str(tmp_path / 'zones.json'), gateway_password='private-password')
    end = datetime.now(timezone.utc) - timedelta(seconds=10)
    start = end - timedelta(seconds=30)
    body = {'requestId': str(uuid4()), 'cameraId': CAMERA, 'promptId': PROMPT,
            'startTime': start.strftime('%Y-%m-%dT%H:%M:%SZ'), 'endTime': end.strftime('%Y-%m-%dT%H:%M:%SZ')}
    summary = {'Id': SUMMARY, 'Progress': 'RequestingSummary', 'Request': {
        'PromptId': PROMPT, 'VideoUris': [f"xprotect://localhost/cameras/{CAMERA}?StartTime={body['startTime']}&EndTime={body['endTime']}"]}}
    calls = []

    def handle(request):
        calls.append(request)
        if request.url.path == '/api/Sessions/Login':
            return httpx.Response(200, json={'Id': 'secret-session'})
        assert request.headers['X-Session-Id'] == 'secret-session'
        if request.url.path == '/api/Prompts/' + PROMPT:
            return httpx.Response(200, json={'Id': PROMPT, 'Title': 'Unique obstruction prompt', 'Text': 'Return one outcome keyword.'})
        if request.url.path == '/api/Prompts':
            return httpx.Response(200, json={'TotalCount': 1, 'PageContent': [{'Id': PROMPT, 'Title': 'Unique obstruction prompt', 'Text': 'Return one outcome keyword.'}]})
        if request.url.path == '/api/Summaries' and request.method == 'POST':
            if summary.get('transportFailure'):
                raise httpx.ReadTimeout('secret upstream detail', request=request)
            return httpx.Response(200, json=summary)
        if request.url.path == '/api/Summaries/' + SUMMARY:
            return httpx.Response(200, json=summary)
        raise AssertionError(str(request.url))

    transport = httpx.MockTransport(handle)
    client = TestClient(create_app(settings, transport), headers={'Authorization': 'Bearer operator'})
    return settings, client, body, summary, calls, transport


def mapping(settings):
    with open(settings.camera_zones_path, 'w') as f:
        json.dump({CAMERA: {'mapId': 'illustrative-site', 'label': 'Illustrative zone, not surveyed', 'mappingType': 'illustrative',
                           'polygon': [{'lat': 56.16, 'lng': 10.2}, {'lat': 56.17, 'lng': 10.2}, {'lat': 56.17, 'lng': 10.21}]}}, f)


def submit(client, body):
    response = client.post('/api/v1/hafnia/gateway/jobs', json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_gateway_submission_sends_saved_prompt_and_explicit_utc_clip(env):
    settings, client, body, summary, calls, _ = env
    result = submit(client, body)
    assert result['summaryId'] == SUMMARY
    request = next(r for r in calls if r.method == 'POST' and r.url.path == '/api/Summaries')
    payload = json.loads(request.content)
    assert payload == {'PromptId': PROMPT, 'Prompt': 'Return one outcome keyword.', 'VideoUris': summary['Request']['VideoUris']}
    assert result['progress'] == 'RequestingSummary'
    assert 'private-password' not in json.dumps(result)
    assert 'secret-session' not in client.get('/api/v1/dashboard').text


def test_refresh_creates_one_incident_and_survives_backend_restart(env):
    settings, client, body, summary, calls, transport = env
    mapping(settings)
    job = submit(client, body)
    summary.update(Progress='Completed', Response='OBSTRUCTION_CONFIRMED.')
    route = f"/api/v1/hafnia/gateway/jobs/{job['id']}/refresh"
    first = client.post(route).json()
    second_client = TestClient(create_app(settings, transport), headers={'Authorization': 'Bearer operator'})
    second = second_client.post(route).json()
    assert first['incidentId'] == second['incidentId']
    real = [r for r in second_client.get('/api/v1/incidents').json() if r['source'] == 'hafnia-gateway']
    assert len(real) == 1
    assert real[0]['status'] == 'Proposed'
    assert real[0]['hafniaEvidence']['summaryId'] == SUMMARY
    assert real[0]['hafniaEvidence']['mappingType'] == 'illustrative'
    assert sum(r.url.path == '/api/Summaries' and r.method == 'POST' for r in calls) == 1


@pytest.mark.parametrize('answer', ['PATH_CLEAR', 'UNCERTAIN', 'No OBSTRUCTION_CONFIRMED is visible', 'OBSTRUCTION_CONFIRMED PATH_CLEAR'])
def test_ambiguous_and_clear_answers_never_create_incidents(env, answer):
    settings, client, body, summary, _, _ = env
    mapping(settings)
    summary.update(Progress='Completed', Response=answer)
    result = submit(client, body)
    assert not result.get('incidentId')
    assert len(client.get('/api/v1/incidents').json()) == 1


def test_import_existing_summary_spends_no_new_request_and_can_map_later(env):
    settings, client, _, summary, calls, _ = env
    summary.update(Progress='Completed', Response='OBSTRUCTION_CONFIRMED')
    result = client.post('/api/v1/hafnia/gateway/import', json={'summaryId': SUMMARY})
    assert result.status_code == 200
    job = result.json()
    assert not job.get('incidentId')
    mapping(settings)
    result = client.post(f"/api/v1/hafnia/gateway/jobs/{job['id']}/refresh").json()
    assert result['incidentId']
    assert not any(r.url.path == '/api/Summaries' and r.method == 'POST' for r in calls)


def test_submission_timeout_is_not_retried_and_same_request_is_idempotent(env):
    _, client, body, summary, calls, _ = env
    summary['transportFailure'] = True
    first = submit(client, body)
    assert first['progress'] == 'Submission uncertain'
    assert submit(client, body)['id'] == first['id']
    assert sum(r.url.path == '/api/Summaries' and r.method == 'POST' for r in calls) == 1
    assert 'secret upstream detail' not in json.dumps(first)


def test_daily_budget_pending_guard_and_demo_reset_preserve_jobs(env):
    settings, client, body, summary, calls, _ = env
    settings.gateway_daily_limit = 1
    job = submit(client, body)
    other = {**body, 'requestId': str(uuid4())}
    assert client.post('/api/v1/hafnia/gateway/jobs', json=other).status_code == 409
    summary.update(Progress='Failed', LastError='private upstream text')
    result = client.post(f"/api/v1/hafnia/gateway/jobs/{job['id']}/refresh")
    assert 'private upstream text' not in result.text
    assert client.post('/api/v1/hafnia/gateway/jobs', json=other).status_code == 429
    client.post('/api/v1/demo/reset')
    assert len(client.get('/api/v1/hafnia/gateway/jobs').json()['jobs']) == 1


def test_clip_validation_and_auth_fail_before_any_gateway_request(env):
    _, client, body, _, calls, _ = env
    assert client.post('/api/v1/hafnia/gateway/jobs', json={**body, 'endTime': '2099-01-01T00:00:00Z'}).status_code == 422
    assert client.post('/api/v1/hafnia/gateway/jobs', json={**body, 'startTime': '2026-01-01T00:00:00'}).status_code == 422
    assert client.get('/api/v1/hafnia/gateway/jobs', headers={'Authorization': ''}).status_code == 401
    assert not calls


def test_gateway_reauthenticates_once_after_expired_session(env):
    settings, _, _, summary, _, _ = env
    from app.gateway import Gateway
    counts = {'login': 0, 'read': 0}
    def handle(request):
        if request.url.path.endswith('/Login'):
            counts['login'] += 1
            return httpx.Response(200, json={'Id': str(counts['login'])})
        counts['read'] += 1
        return httpx.Response(401) if counts['read'] == 1 else httpx.Response(200, json=summary)
    assert Gateway(settings, httpx.MockTransport(handle)).summary(SUMMARY)['Id'] == SUMMARY
    assert counts == {'login': 2, 'read': 2}


def test_import_does_not_release_an_unrelated_submission_reservation(env):
    _, client, body, summary, _, _ = env
    summary.update(Progress='Completed', Response='PATH_CLEAR')
    base = {'id': 'interrupted', 'cameraId': CAMERA, 'summaryId': None,
            'progress': 'Submitting', 'startTime': body['startTime'], 'endTime': body['endTime']}
    other = {**base, 'id': 'unrelated', 'cameraId': str(uuid4())}
    with client.app.state.store.transaction() as state:
        state['hafniaJobs'] = [base, other]
    response = client.post('/api/v1/hafnia/gateway/import', json={'summaryId': SUMMARY})
    assert response.status_code == 200
    jobs = {j['id']: j for j in client.get('/api/v1/hafnia/gateway/jobs').json()['jobs']}
    assert jobs['interrupted']['progress'] == 'Submission uncertain'
    assert jobs['unrelated']['progress'] == 'Submitting'
