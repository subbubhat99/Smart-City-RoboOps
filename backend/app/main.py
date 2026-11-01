import hmac
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from .config import Settings
from .connectors import Connectors
from .operations import apply_action, check_revision, edit_boundary, find, initial_state, new_incident, now, record
from .store import Store
from .gateway import Gateway
from .gateway_routes import install_gateway_routes


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Action(StrictModel):
    action: Literal['begin_review', 'approve', 'reject', 'dispatch', 'robot_response', 'confirm_replan', 'request_clearance', 'approve_clearance', 'dispatch_clearance', 'clearance_response', 'close_unsent']
    expectedRevision: int = Field(ge=1)
    robotId: str | None = None
    reason: str = Field('', max_length=2000)
    outcome: Literal['Fleet accepted', 'Robot applied', 'Rejected', 'Timed out', 'Failed'] | None = None


class Point(StrictModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class Boundary(StrictModel):
    polygon: list[Point] = Field(min_length=3, max_length=500)
    expectedRevision: int = Field(ge=1)


class Observation(StrictModel):
    cameraId: str = Field(min_length=1, max_length=200)
    externalId: str = Field(min_length=1, max_length=200)
    obstruction: bool
    title: str = Field(min_length=1, max_length=200)
    explanation: str = Field('', max_length=2000)
    observedAt: datetime | None = None


class ImageAnalysis(StrictModel):
    cameraId: str = Field(min_length=1, max_length=200)
    imageDataUrl: str = Field(max_length=5_400_000)


def create_app(settings=None, transport=None):
    settings = settings or Settings()
    store = Store(settings.database, initial_state)
    connectors = Connectors(settings, transport)
    gateway = Gateway(settings, transport)
    app = FastAPI(title='Smart City RoboOps', version='1.0.0')
    app.state.store, app.state.connectors, app.state.settings = store, connectors, settings
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=['GET', 'POST', 'PATCH'], allow_headers=['Authorization', 'Content-Type'])

    def authorize(request: Request, authorization: str = Header('')):
        if settings.operator_token:
            if not hmac.compare_digest(authorization, 'Bearer ' + settings.operator_token):
                raise HTTPException(401, 'Operator session token required')
        elif __import__('os').getenv('REPL_ID') or not request.client or request.client.host not in ('127.0.0.1', '::1', 'localhost', 'testclient'):
            raise HTTPException(401, 'Configure ROBOOPS_OPERATOR_TOKEN before remote access')

    auth = [Depends(authorize)]

    @app.get('/api/health')
    def health():
        return {'status': 'ok', 'fleetMode': 'simulated'}

    def integration_status():
        return {'xprotect': {'configured': bool(settings.xprotect_url and settings.xprotect_token_url and settings.xprotect_username and settings.xprotect_password), 'eventPublishingConfigured': bool(settings.xprotect_event_type)},
                'hafnia': {'configured': bool(settings.hafnia_url and settings.hafnia_key and settings.hafnia_model), 'profile': 'OpenAI-compatible image analysis; verify with environment documentation', 'webhookConfigured': bool(settings.webhook_token)},
                'gateway': {'configured': bool(settings.gateway_password), 'dailySubmissionLimit': settings.gateway_daily_limit,
                            'profile': 'VM-local Hafnia video summaries; configured does not mean connected'},
                'cameraZones': [{'cameraId': k, 'mapId': v.get('mapId', ''), 'label': v.get('label', k)} for k, v in settings.camera_zones().items()],
                'obstructionEventImportConfigured': bool(settings.obstruction_event_types), 'fleetMode': 'simulated', 'liveFleetConfigured': False}

    @app.get('/api/v1/dashboard', dependencies=auth)
    def dashboard():
        with store.transaction() as state:
            for item in state['restrictions']:
                if item['status'] == 'Approved' and datetime.fromisoformat(item['expiresAt']) < datetime.now(timezone.utc):
                    item['status'], item['revision'] = 'Review overdue', item['revision'] + 1
                    record(item, 'Review deadline passed; restriction remains active.', actor='system', tone='warn')
            return {**state, 'integrations': integration_status(), 'serverTime': now()}

    @app.get('/api/v1/incidents', dependencies=auth)
    def incidents():
        return dashboard()['restrictions']

    @app.post('/api/v1/incidents/simulate', dependencies=auth)
    def simulate():
        with store.transaction() as state:
            return new_incident(state)

    @app.post('/api/v1/demo/reset', dependencies=auth)
    def reset():
        with store.transaction() as state:
            # Real observations are retained even when resetting the fictional fleet demo.
            real = [r for r in state['restrictions'] if r['source'] != 'simulation']
            jobs = state.get('hafniaJobs', [])
            state.clear()
            state.update(initial_state())
            state['restrictions'].extend(real)
            state['hafniaJobs'] = jobs
        return dashboard()

    @app.get('/api/v1/incidents/{incident_id}', dependencies=auth)
    def incident(incident_id: str):
        return find(store.read(), incident_id)

    @app.patch('/api/v1/restrictions/{incident_id}/boundary', dependencies=auth)
    def boundary(incident_id: str, body: Boundary):
        with store.transaction() as state:
            item = find(state, incident_id)
            check_revision(item, body.expectedRevision)
            return edit_boundary(state, item, [p.model_dump() for p in body.polygon])

    @app.post('/api/v1/restrictions/{incident_id}/actions', dependencies=auth)
    def action(incident_id: str, body: Action):
        # Outcome injection is explicit simulation only, and cannot skip acceptance.
        allowed = {'dispatch': {'Fleet accepted', 'Rejected', 'Timed out', 'Failed'}, 'robot_response': {'Robot applied', 'Rejected', 'Timed out', 'Failed'},
                   'dispatch_clearance': {'Fleet accepted', 'Rejected', 'Timed out', 'Failed'}, 'clearance_response': {'Robot applied', 'Rejected', 'Timed out', 'Failed'}}
        if body.outcome and body.outcome not in allowed.get(body.action, set()):
            raise HTTPException(422, 'Outcome is not valid for this transition')
        with store.transaction() as state:
            item = find(state, incident_id)
            check_revision(item, body.expectedRevision)
            return apply_action(state, item, body.action, body.robotId, body.reason, body.outcome)

    @app.get('/api/v1/integrations', dependencies=auth)
    def integrations():
        return integration_status()

    @app.get('/api/v1/restrictions/{incident_id}/preview', dependencies=auth)
    def preview(incident_id: str, robotId: str):
        state = store.read()
        item = find(state, incident_id)
        robot = next((r for r in state['robots'] if r['id'] == robotId), None)
        if not robot or robotId not in item['recipients']:
            raise HTTPException(404, 'Affected robot not found')
        return {'illustrative': True, 'validatedVda5050Message': False, 'recipient': robotId,
                'operation': 'propose_blocked_zone' if 'BLOCKED zone' in robot['capabilities'] else 'fleet_specific_route_restriction',
                'fleetAdapter': robot['profile'], 'robotMapId': robot['mapId'], 'zoneSetId': item['zoneSetId'],
                'inputGeometry': {'type': 'Polygon', 'coordinates': [[[p['lng'], p['lat']] for p in [*item['polygon'], item['polygon'][0]]]]},
                'coordinateSpace': 'WGS84 longitude/latitude, NOT robot map coordinates',
                'requiredNextStep': 'Fleet adapter must transform the surveyed geometry, assemble the complete active zone set, validate its supported VDA 5050 schema, and confirm application. No robot command is sent by this preview.'}

    @app.get('/api/v1/xprotect/cameras', dependencies=auth)
    def cameras():
        return connectors.cameras()

    @app.get('/api/v1/xprotect/events', dependencies=auth)
    def events(since: datetime | None = None):
        return connectors.events(since.isoformat() if since else None)

    @app.post('/api/v1/incidents/{incident_id}/xprotect-event', dependencies=auth)
    def publish(incident_id: str):
        with store.transaction() as state:
            item = find(state, incident_id)
            if item['source'] == 'simulation' or item['status'] not in ('Approved', 'Review overdue'):
                raise HTTPException(409, 'Publish only an approved real observation')
            if item['xprotectEventPublished']:
                return {'published': True, 'alreadyPublished': True}
            connectors.publish_event(item['cameraId'], f"RoboOps {item['id']}: {item['title']}")
            item['xprotectEventPublished'], item['revision'] = True, item['revision'] + 1
            record(item, 'XProtect accepted the incident event. Alarm creation depends on configured rules.', actor='xprotect')
        return {'published': True}

    def ingest(body: Observation, source: str, evidence=None):
        mapping = settings.camera_zones().get(body.cameraId)
        if not mapping or not mapping.get('mapId') or not mapping.get('polygon'):
            raise HTTPException(422, 'Configure a surveyed geographic zone and mapId for this camera before creating incidents')
        with store.transaction() as state:
            existing = next((r for r in state['restrictions'] if r.get('cameraId') == body.cameraId and r.get('externalId') == body.externalId), None)
            if existing:
                return {'incident': existing, 'duplicate': True}
            if not body.obstruction:
                return {'incident': None, 'message': 'No obstruction detected. Existing restrictions remain unchanged.'}
            item = new_incident(state, title=body.title, polygon=mapping['polygon'], camera_id=body.cameraId, source=source, external_id=body.externalId, note=body.explanation)
            item['mapId'], item['evidenceDataUrl'] = mapping['mapId'], evidence
            if body.observedAt:
                item['observedAt'] = body.observedAt.isoformat()
            return {'incident': item, 'duplicate': False}

    @app.post('/api/v1/xprotect/import-events', dependencies=auth)
    def import_events(since: datetime | None = None):
        if not settings.obstruction_event_types:
            raise HTTPException(503, 'Configure the XProtect event type IDs emitted for obstructions by your Hafnia plugin or analytics rules')
        if settings.xprotect_event_type and settings.xprotect_event_type in settings.obstruction_event_types:
            raise HTTPException(503, 'Incoming obstruction event types must differ from the outgoing event type to prevent an ingestion loop')
        previous = store.read().get('lastEventImport')
        start = since or (datetime.fromisoformat(previous) - timedelta(seconds=30) if previous else datetime.now(timezone.utc) - timedelta(minutes=15))
        end = now()
        rows = connectors.event_window(start.isoformat(), end)
        summary = {'scanned': len(rows), 'created': 0, 'duplicates': 0, 'unmapped': 0, 'unrelated': 0}
        for row in rows:
            if row.get('type') not in settings.obstruction_event_types:
                summary['unrelated'] += 1
                continue
            camera = str(row.get('source', '')).removeprefix('cameras/')
            if camera not in settings.camera_zones():
                summary['unmapped'] += 1
                continue
            if not row.get('id'):
                raise HTTPException(502, 'XProtect obstruction event has no stable ID; import checkpoint was not advanced')
            try:
                body = Observation(cameraId=camera, externalId=str(row['id']), obstruction=True, title='Camera-reported obstruction', explanation=str(row.get('tag') or 'Configured obstruction event received from XProtect. Operator verification required.')[:2000], observedAt=row.get('time'))
            except ValueError as exc:
                raise HTTPException(502, 'XProtect obstruction event has invalid metadata') from exc
            result = ingest(body, 'xprotect-event')
            summary['duplicates' if result['duplicate'] else 'created'] += 1
        with store.transaction() as state:
            state['lastEventImport'] = end
        return summary

    @app.post('/api/v1/hafnia/observations')
    def webhook(body: Observation, authorization: str = Header('')):
        if not settings.webhook_token or not hmac.compare_digest(authorization, 'Bearer ' + settings.webhook_token):
            raise HTTPException(401, 'Analysis webhook token required')
        return ingest(body, 'hafnia-plugin')

    @app.post('/api/v1/hafnia/analyze', dependencies=auth)
    def analyze(body: ImageAnalysis):
        from .operations import uid
        if body.cameraId not in settings.camera_zones():
            raise HTTPException(422, 'Map this camera to a surveyed geographic zone before analysis')
        result = connectors.analyze(body.imageDataUrl)
        observation = Observation(cameraId=body.cameraId, externalId=uid('ANALYSIS'), **result)
        return {**ingest(observation, 'hafnia-image', body.imageDataUrl), 'analysis': result}

    install_gateway_routes(app, settings, store, gateway, auth, ingest, Observation)

    # Optional single-process deployment: build the frontend first.
    public = Path(__file__).resolve().parents[2] / 'artifacts/smart-city-roboops/dist/public'
    if public.exists():
        app.mount('/', StaticFiles(directory=public, html=True), name='frontend')
    return app


app = create_app()
