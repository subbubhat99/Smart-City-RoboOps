import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException

from .geometry import affected, validate_polygon


def now():
    return datetime.now(timezone.utc).isoformat()


def uid(prefix):
    return f'{prefix}-{uuid.uuid4().hex[:12].upper()}'


def record(item, message, actor='operator', tone='neutral'):
    item['dispatchLog'].insert(0, {'at': now(), 'message': message, 'tone': tone, 'actor': actor, 'correlationId': uid('EVT')})


def new_incident(state, *, title='Construction barrier on paving', polygon=None, camera_id='CAM-14', source='simulation', external_id=None, note=None):
    polygon = polygon or [dict(lat=56.16025, lng=10.20995), dict(lat=56.16065, lng=10.21045), dict(lat=56.16045, lng=10.21095), dict(lat=56.16005, lng=10.21055)]
    shape = validate_polygon(polygon)
    mission_ids = affected(polygon, state['missions'])
    recipients = {m['robot']: 'Not sent' for m in state['missions'] if m['id'] in mission_ids}
    item = dict(id=uid('OBS'), revision=1, title=title, observedAt=now(), status='Proposed', robot=', '.join(recipients) or 'No affected robots',
                mapId='aarhus_mid-01' if source == 'simulation' else '', center=dict(lat=shape.centroid.y, lng=shape.centroid.x), polygon=polygon,
                missionIds=mission_ids, note=note or 'Simulated observation; operator review required.',
                expiresAt=(datetime.now(timezone.utc) + timedelta(hours=4)).isoformat(), zoneSetId=uid('ZS'),
                recipients=recipients, clearance='none', clearanceRecipients={}, replans={}, dispatchLog=[],
                source=source, cameraId=camera_id, externalId=external_id, evidenceDataUrl=None, xprotectEventPublished=False)
    record(item, f'Observation received from {source}; {len(mission_ids)} remaining mission paths intersect the proposed zone.', actor=source)
    state['restrictions'].insert(0, item)
    return item


def initial_state():
    state = json.loads((Path(__file__).resolve().parents[2] / 'shared' / 'demo.json').read_text(encoding='utf-8'))
    state['restrictions'] = []
    new_incident(state)
    return state


def find(state, incident_id):
    item = next((r for r in state['restrictions'] if r['id'] == incident_id), None)
    if item is None:
        raise HTTPException(404, 'Incident not found')
    return item


def check_revision(item, expected):
    if item['revision'] != expected:
        raise HTTPException(409, 'This incident changed. Refresh before retrying the action.')


def check(condition, message):
    if not condition:
        raise HTTPException(409, message)


def apply_action(state, item, action, robot_id=None, reason='', outcome=None):
    name = action
    active = item['status'] in ('Approved', 'Review overdue')
    robot = next((r for r in state['robots'] if r['id'] == robot_id), None)
    if name == 'begin_review':
        check(item['status'] == 'Proposed', 'Only proposed observations can enter review')
        item['status'] = 'Under review'
    elif name == 'approve':
        check(item['status'] == 'Under review', 'Begin inspection before approval')
        item['status'] = 'Approved'
    elif name == 'reject':
        check(item['status'] in ('Proposed', 'Under review'), 'Active restrictions must use the clearance workflow')
        item['status'] = 'Rejected'
    elif name in ('dispatch', 'robot_response', 'confirm_replan'):
        check(active and item['clearance'] == 'none', 'Approve an active restriction before delivery')
        check(robot is not None and robot_id in item['recipients'], 'Robot is not an affected recipient')
        check(not robot['alignment'].startswith('Not aligned'), 'Robot map alignment is required')
        check(item['source'] == 'simulation', 'Real observations cannot be dispatched to fictional demo fleets')
        check(any(c in robot['capabilities'] for c in ('BLOCKED zone', 'Fleet-specific route restriction')), 'Unsupported restriction operation')
        previous = item['recipients'][robot_id]
        if name == 'dispatch':
            check(previous != 'Robot applied', 'Restriction is already applied')
            item['recipients'][robot_id] = outcome or 'Fleet accepted'
        elif name == 'robot_response':
            check(previous == 'Fleet accepted', 'Fleet acceptance is required before robot application')
            item['recipients'][robot_id] = outcome or 'Robot applied'
        else:
            check(previous == 'Robot applied', 'Robot must apply the restriction before replanning is confirmed')
            from shapely.geometry import LineString
            zone = validate_polygon(item['polygon'])
            mission = next((m for m in state['missions'] if m['robot'] == robot_id and m['id'] in item['missionIds'] and m.get('alternative')), None)
            check(mission is not None, 'No predefined alternative route exists for this mission')
            line = LineString([(p['lng'], p['lat']) for p in mission['alternative']])
            check(not zone.intersects(line), 'The alternative route intersects this restriction')
            for other in state['restrictions']:
                if other['id'] != item['id'] and other['status'] in ('Approved', 'Review overdue'):
                    check(not validate_polygon(other['polygon']).intersects(line), 'Another active restriction blocks this alternative route')
            item['replans'][robot_id] = 'Confirmed'
            mission['activePoints'] = mission['alternative']
    elif name == 'request_clearance':
        check(active and item['clearance'] == 'none', 'Clearance requires an active restriction')
        item['clearance'] = 'review'
    elif name == 'approve_clearance':
        check(active and item['clearance'] == 'review', 'Request clearance review first')
        check(bool(reason.strip()), 'Record the evidence or rationale for reopening')
        item['clearance'] = 'approved'
        # Include uncertain recipients: a timeout does not prove the restriction was never received.
        item['clearanceRecipients'] = {r: 'Not sent' for r, status in item['recipients'].items() if status != 'Not sent'}
        item['clearanceZoneSetId'] = uid('ZS')
    elif name in ('dispatch_clearance', 'clearance_response'):
        check(active and item['clearance'] == 'approved', 'Approve clearance review first')
        check(item['source'] == 'simulation', 'No live fleet adapter is configured')
        check(robot_id in item['clearanceRecipients'], 'Robot is not a clearance recipient')
        previous = item['clearanceRecipients'][robot_id]
        if name == 'dispatch_clearance':
            check(previous != 'Robot applied', 'Clearance already applied')
            item['clearanceRecipients'][robot_id] = outcome or 'Fleet accepted'
        else:
            check(previous == 'Fleet accepted', 'Fleet acceptance is required before clearance application')
            item['clearanceRecipients'][robot_id] = outcome or 'Robot applied'
        if item['clearanceRecipients'] and all(s == 'Robot applied' for s in item['clearanceRecipients'].values()):
            item['clearance'], item['status'] = 'cleared', 'Cleared'
    elif name == 'close_unsent':
        check(active and item['clearance'] == 'approved' and not item['clearanceRecipients'], 'Only restrictions never dispatched can close without robot acknowledgements')
        item['clearance'], item['status'] = 'cleared', 'Cleared'
    else:
        raise HTTPException(422, 'Unknown operation')
    item['revision'] += 1
    result = item['clearanceRecipients'].get(robot_id, '') if 'clearance' in name else item['recipients'].get(robot_id, '')
    record(item, f'{name.replace("_", " ")}: {robot_id or "restriction"}. {result} {reason}'.strip() + (' [SIMULATED FLEET]' if robot_id else ''))
    return item


def edit_boundary(state, item, points):
    check(item['status'] in ('Proposed', 'Under review'), 'Active boundaries are immutable. Create and approve a replacement observation, then clear the old restriction.')
    shape = validate_polygon(points)
    item.update(polygon=points, center=dict(lat=shape.centroid.y, lng=shape.centroid.x), status='Proposed', zoneSetId=uid('ZS'), revision=item['revision'] + 1)
    item['missionIds'] = affected(points, state['missions'])
    item['recipients'] = {m['robot']: 'Not sent' for m in state['missions'] if m['id'] in item['missionIds']}
    item['robot'] = ', '.join(item['recipients']) or 'No affected robots'
    item['replans'] = {}
    record(item, 'Proposed boundary updated; fresh zone set assigned and approval required.')
    return item
