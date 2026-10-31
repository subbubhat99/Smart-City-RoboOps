import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.operations import initial_state
from app.geometry import affected


@pytest.fixture
def config(tmp_path):
    return Settings(database=str(tmp_path / 'state.sqlite3'), operator_token='test-operator', camera_zones_path=str(tmp_path / 'zones.json'))


@pytest.fixture
def client(config):
    return TestClient(create_app(config), headers={'Authorization': 'Bearer test-operator'})


def item(client):
    return client.get('/api/v1/dashboard').json()['restrictions'][0]


def act(client, incident, name, **kwargs):
    response = client.post(f"/api/v1/restrictions/{incident['id']}/actions", json={'action': name, 'expectedRevision': incident['revision'], **kwargs})
    assert response.status_code == 200, response.text
    return response.json()


def approved(client):
    return act(client, act(client, item(client), 'begin_review'), 'approve')


def test_authentication_and_configuration_do_not_leak_secrets(config):
    client = TestClient(create_app(config))
    assert client.get('/api/health').status_code == 200
    assert client.get('/api/v1/dashboard').status_code == 401
    result = client.get('/api/v1/integrations', headers={'Authorization': 'Bearer test-operator'})
    assert result.status_code == 200
    assert 'test-operator' not in result.text


def test_approval_application_replan_and_clearance_are_separate(client):
    incident = approved(client)
    assert set(incident['recipients']) == {'Moss-03', 'Birk-07'}
    assert all(s == 'Not sent' for s in incident['recipients'].values())
    incident = act(client, incident, 'dispatch', robotId='Moss-03')
    assert incident['recipients']['Moss-03'] == 'Fleet accepted'
    assert not incident['replans']
    incident = act(client, incident, 'robot_response', robotId='Moss-03')
    assert not incident['replans']
    incident = act(client, incident, 'confirm_replan', robotId='Moss-03')
    assert incident['replans']['Moss-03'] == 'Confirmed'
    incident = act(client, incident, 'dispatch', robotId='Birk-07', outcome='Timed out')
    assert incident['recipients']['Birk-07'] == 'Timed out'
    incident = act(client, incident, 'request_clearance')
    incident = act(client, incident, 'approve_clearance', reason='Fresh footage and operator inspection confirm clearance')
    assert set(incident['clearanceRecipients']) == {'Moss-03', 'Birk-07'}
    for robot in ('Moss-03', 'Birk-07'):
        incident = act(client, incident, 'dispatch_clearance', robotId=robot)
        assert incident['status'] != 'Cleared'
        incident = act(client, incident, 'clearance_response', robotId=robot)
        if robot == 'Moss-03':
            assert incident['status'] == 'Approved'
    assert incident['status'] == 'Cleared'
    assert incident['clearanceZoneSetId'] != incident['zoneSetId']


def test_stale_revision_cannot_overwrite_new_state(client):
    old = item(client)
    current = act(client, old, 'begin_review')
    response = client.post(f"/api/v1/restrictions/{old['id']}/actions", json={'action': 'reject', 'expectedRevision': old['revision']})
    assert response.status_code == 409
    assert item(client)['status'] == current['status']


def test_dispatch_cannot_skip_operator_review(client):
    old = item(client)
    response = client.post(f"/api/v1/restrictions/{old['id']}/actions", json={'action': 'dispatch', 'expectedRevision': old['revision'], 'robotId': 'Moss-03'})
    assert response.status_code == 409


def test_cannot_forge_robot_application_on_submission(client):
    old = approved(client)
    response = client.post(f"/api/v1/restrictions/{old['id']}/actions", json={'action': 'dispatch', 'expectedRevision': old['revision'], 'robotId': 'Moss-03', 'outcome': 'Robot applied'})
    assert response.status_code == 422


@pytest.mark.parametrize('polygon', [
    [{'lat': 0, 'lng': 0}, {'lat': 1, 'lng': 1}, {'lat': 1, 'lng': 0}, {'lat': 0, 'lng': 1}],
    [{'lat': 0, 'lng': 0}, {'lat': 0, 'lng': 0}, {'lat': 0, 'lng': 0}],
    [{'lat': 95, 'lng': 0}, {'lat': 1, 'lng': 1}, {'lat': 1, 'lng': 0}],
])
def test_invalid_boundaries_are_rejected(client, polygon):
    old = item(client)
    response = client.patch(f"/api/v1/restrictions/{old['id']}/boundary", json={'expectedRevision': old['revision'], 'polygon': polygon})
    assert response.status_code == 422
    assert item(client)['zoneSetId'] == old['zoneSetId']


def test_new_boundary_requires_new_review_and_recomputes_impacts(client):
    old = act(client, item(client), 'begin_review')
    polygon = [{'lat': 55, 'lng': 10}, {'lat': 55.01, 'lng': 10}, {'lat': 55, 'lng': 10.01}]
    response = client.patch(f"/api/v1/restrictions/{old['id']}/boundary", json={'expectedRevision': old['revision'], 'polygon': polygon})
    assert response.status_code == 200
    changed = response.json()
    assert changed['zoneSetId'] != old['zoneSetId']
    assert changed['status'] == 'Proposed'
    assert not changed['missionIds']
    assert not changed['recipients']


def test_active_boundary_is_not_silently_replaced(client):
    old = approved(client)
    assert client.patch(f"/api/v1/restrictions/{old['id']}/boundary", json={'expectedRevision': old['revision'], 'polygon': old['polygon']}).status_code == 409


def test_route_is_not_treated_as_a_closed_polygon():
    zone = [{'lng': 0.1, 'lat': 0.8}, {'lng': 0.2, 'lat': 0.8}, {'lng': 0.2, 'lat': 0.9}]
    missions = [{'id': 'M', 'progress': 0, 'points': [{'lng': 0, 'lat': 0}, {'lng': 1, 'lat': 0}, {'lng': 1, 'lat': 1}]}]
    assert affected(zone, missions) == []
    missions[0]['points'] = [{'lng': 0.15, 'lat': 0}, {'lng': 0.15, 'lat': 1}]
    assert affected(zone, missions) == ['M']
    missions[0]['progress'] = 99
    assert affected(zone, missions) == []


def test_persistence_across_restarts(client, config):
    incident = approved(client)
    other = TestClient(create_app(config), headers={'Authorization': 'Bearer test-operator'})
    assert item(other)['status'] == 'Approved'
    assert item(other)['revision'] == incident['revision']


def test_overdue_restrictions_stay_active(client):
    old = approved(client)
    with client.app.state.store.transaction() as state:
        state['restrictions'][0]['expiresAt'] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    assert item(client)['status'] == 'Review overdue'


def configure_camera(config):
    polygon = initial_state()['restrictions'][0]['polygon']
    with open(config.camera_zones_path, 'w') as f:
        json.dump({'real-camera': {'mapId': 'surveyed-map', 'polygon': polygon}}, f)
    config.webhook_token = 'webhook-secret'


def test_webhook_requires_token_deduplicates_and_cannot_clear(config):
    configure_camera(config)
    client = TestClient(create_app(config))
    payload = {'cameraId': 'real-camera', 'externalId': 'event-1', 'obstruction': True, 'title': 'Barrier', 'explanation': 'Blocked route'}
    assert client.post('/api/v1/hafnia/observations', json=payload).status_code == 401
    headers = {'Authorization': 'Bearer webhook-secret'}
    first = client.post('/api/v1/hafnia/observations', json=payload, headers=headers)
    assert first.status_code == 200
    assert first.json()['incident']['mapId'] == 'surveyed-map'
    assert client.post('/api/v1/hafnia/observations', json=payload, headers=headers).json()['duplicate']
    payload.update(externalId='event-2', obstruction=False)
    assert client.post('/api/v1/hafnia/observations', json=payload, headers=headers).json()['incident'] is None
    state = client.app.state.store.read()
    assert state['restrictions'][0]['status'] == 'Proposed'


def test_unmapped_webhook_does_not_invent_coordinates(config):
    config.webhook_token = 'webhook-secret'
    client = TestClient(create_app(config))
    response = client.post('/api/v1/hafnia/observations', headers={'Authorization': 'Bearer webhook-secret'}, json={'cameraId': 'unknown', 'externalId': '1', 'obstruction': True, 'title': 'Barrier'})
    assert response.status_code == 422


def test_xprotect_connector_uses_server_credentials_and_correct_single_event_contract(config):
    config.xprotect_url = 'https://vms.example'
    config.xprotect_token_url = 'https://vms.example/API/IDP/connect/token'
    config.xprotect_username, config.xprotect_password = 'operator', 'private-password'
    config.xprotect_event_type = 'configured-event-type'
    calls = []
    def upstream(req):
        calls.append(req)
        if req.url.path.endswith('/token'):
            return httpx.Response(200, json={'access_token': 'upstream-secret', 'expires_in': 3600})
        assert req.headers['Authorization'] == 'Bearer upstream-secret'
        if req.method == 'POST':
            data = json.loads(req.content)
            assert isinstance(data, dict) and data['tag'].startswith('RoboOps')
            assert 'message' not in data
            return httpx.Response(202, json={'data': {'id': 'event-id'}})
        return httpx.Response(200, json={'array': [{'id': 'real-camera'}]})
    client = TestClient(create_app(config, httpx.MockTransport(upstream)), headers={'Authorization': 'Bearer test-operator'})
    response = client.get('/api/v1/xprotect/cameras')
    assert response.status_code == 200 and 'upstream-secret' not in response.text
    client.app.state.connectors.publish_event('real-camera', 'RoboOps test')
    assert len([c for c in calls if c.url.path.endswith('/token')]) == 1


def test_upstream_errors_are_redacted(config):
    config.xprotect_url, config.xprotect_token_url = 'https://vms.example', 'https://vms.example/token'
    config.xprotect_username, config.xprotect_password = 'operator', 'private-password'
    client = TestClient(create_app(config, httpx.MockTransport(lambda req: httpx.Response(403, text='private-password'))), headers={'Authorization': 'Bearer test-operator'})
    result = client.get('/api/v1/xprotect/cameras')
    assert result.status_code == 502
    assert 'private-password' not in result.text


def test_hafnia_image_result_creates_proposal_with_evidence(config):
    import base64
    configure_camera(config)
    config.hafnia_url, config.hafnia_key, config.hafnia_model = 'https://vlm.example/chat/completions', 'private-key', 'configured-model'
    def upstream(req):
        assert req.headers['Authorization'] == 'Bearer private-key'
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps({'obstruction': True, 'title': 'Road barriers', 'explanation': 'Barriers visible'})}}]})
    client = TestClient(create_app(config, httpx.MockTransport(upstream)), headers={'Authorization': 'Bearer test-operator'})
    image = 'data:image/jpeg;base64,' + base64.b64encode(b'\xff\xd8\xfftest-image').decode()
    result = client.post('/api/v1/hafnia/analyze', json={'cameraId': 'real-camera', 'imageDataUrl': image})
    assert result.status_code == 200
    incident = result.json()['incident']
    assert incident['source'] == 'hafnia-image' and incident['status'] == 'Proposed'
    assert incident['evidenceDataUrl'] == image
    assert 'private-key' not in result.text


def test_demo_reset_does_not_delete_real_observations(config):
    configure_camera(config)
    client = TestClient(create_app(config), headers={'Authorization': 'Bearer test-operator'})
    client.post('/api/v1/hafnia/observations', headers={'Authorization': 'Bearer webhook-secret'}, json={'cameraId': 'real-camera', 'externalId': '1', 'obstruction': True, 'title': 'Barrier'})
    reset = client.post('/api/v1/demo/reset')
    assert len(reset.json()['restrictions']) == 2


def test_no_fake_fleet_dispatch_for_real_observations(config):
    configure_camera(config)
    client = TestClient(create_app(config), headers={'Authorization': 'Bearer test-operator'})
    result = client.post('/api/v1/hafnia/observations', headers={'Authorization': 'Bearer webhook-secret'}, json={'cameraId': 'real-camera', 'externalId': '1', 'obstruction': True, 'title': 'Barrier'})
    incident = act(client, act(client, result.json()['incident'], 'begin_review'), 'approve')
    response = client.post(f"/api/v1/restrictions/{incident['id']}/actions", json={'action': 'dispatch', 'expectedRevision': incident['revision'], 'robotId': 'Moss-03'})
    assert response.status_code == 409


def test_import_plugin_events_deduplicates_and_uses_camera_zone(config):
    configure_camera(config)
    config.xprotect_url, config.xprotect_token_url = 'https://vms.example', 'https://vms.example/token'
    config.xprotect_username, config.xprotect_password = 'operator', 'password'
    config.obstruction_event_types = ['obstruction-event-type']
    def upstream(req):
        if req.url.path == '/token':
            return httpx.Response(200, json={'access_token': 'secret', 'expires_in': 3600})
        assert req.url.params['size'] == '100'
        assert req.url.params['orderBy'] == "desc:'time'"
        return httpx.Response(200, json={'array': [
            {'id': 'source-event', 'type': 'obstruction-event-type', 'source': 'cameras/real-camera', 'time': '2026-10-22T10:00:00Z', 'tag': 'VLM: barriers'},
            {'id': 'other-event', 'type': 'motion-event', 'source': 'cameras/real-camera'},
        ]})
    client = TestClient(create_app(config, httpx.MockTransport(upstream)), headers={'Authorization': 'Bearer test-operator'})
    first = client.post('/api/v1/xprotect/import-events')
    assert first.status_code == 200, first.text
    assert first.json()['created'] == 1
    assert first.json()['unrelated'] == 1
    assert client.post('/api/v1/xprotect/import-events').json()['duplicates'] == 1
    newest = item(client)
    assert newest['source'] == 'xprotect-event' and newest['status'] == 'Proposed'
    assert newest['observedAt'].startswith('2026-10-22T10:00:00')


def test_event_window_fetches_all_pages_and_does_not_follow_external_urls(config):
    config.xprotect_url, config.xprotect_token_url = 'https://vms.example', 'https://vms.example/token'
    config.xprotect_username, config.xprotect_password = 'operator', 'password'
    pages = []
    def upstream(req):
        if req.url.path == '/token':
            return httpx.Response(200, json={'access_token': 'secret'})
        page = int(req.url.params['page']); pages.append(page)
        assert req.url.host == 'vms.example'
        return httpx.Response(200, json={'array': [{}] * (100 if page == 0 else 1), '_links': {'next': 'https://untrusted.example'}})
    app = create_app(config, httpx.MockTransport(upstream))
    assert len(app.state.connectors.event_window('2026-10-22T10:00:00Z', '2026-10-22T10:10:00Z')) == 101
    assert pages == [0, 1]


def test_unknown_camera_and_unsupported_recipient_cannot_be_dispatched(client):
    old = approved(client)
    result = client.post(f"/api/v1/restrictions/{old['id']}/actions", json={'action': 'dispatch', 'expectedRevision': old['revision'], 'robotId': 'Lime-02'})
    assert result.status_code == 409


def test_new_observations_use_the_confirmed_active_route(client):
    old = approved(client)
    old = act(client, old, 'dispatch', robotId='Moss-03')
    old = act(client, old, 'robot_response', robotId='Moss-03')
    act(client, old, 'confirm_replan', robotId='Moss-03')
    new = client.post('/api/v1/incidents/simulate').json()
    assert 'MIS-118' not in new['missionIds']
    assert 'MIS-121' in new['missionIds']


def test_event_type_loop_is_rejected(config):
    config.xprotect_event_type = 'same-type'
    config.obstruction_event_types = ['same-type']
    client = TestClient(create_app(config), headers={'Authorization': 'Bearer test-operator'})
    assert client.post('/api/v1/xprotect/import-events').status_code == 503
