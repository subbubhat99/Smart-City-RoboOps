"""Persistent, explicitly requested clip jobs; refreshes never submit another clip."""
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import AwareDatetime, BaseModel, ConfigDict

from .operations import now, uid


class ClipRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    requestId: UUID
    cameraId: UUID
    promptId: UUID
    startTime: AwareDatetime
    endTime: AwareDatetime


class ImportRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    summaryId: UUID


TERMINAL = {'Completed', 'Failed', 'Submission uncertain', 'Timed out'}


def install_gateway_routes(app, settings, store, gateway, auth, ingest, observation_type):
    router = APIRouter(prefix='/api/v1/hafnia/gateway', dependencies=auth)

    def lookup(job_id):
        job = next((j for j in store.read().get('hafniaJobs', []) if j['id'] == job_id), None)
        if not job:
            raise HTTPException(404, 'Analysis job not found')
        return job

    def save(job):
        with store.transaction() as state:
            jobs = state.setdefault('hafniaJobs', [])
            index = next((i for i, j in enumerate(jobs) if j['id'] == job['id']), None)
            if index is None:
                jobs.insert(0, job)
            else:
                jobs[index] = job
        return job

    def consume(job, summary):
        if str(summary.get('Id', '')).lower() != job['summaryId'].lower():
            raise HTTPException(502, 'Gateway returned a different summary ID')
        progress = summary.get('Progress')
        if progress not in {'NotStarted', 'FetchingVideo', 'TransferringAssets', 'RequestingSummary', 'Completed', 'Failed'}:
            raise HTTPException(502, 'Unexpected gateway progress value')
        job['progress'], job['updatedAt'] = progress, now()
        if progress == 'Failed':
            job['message'] = 'Gateway analysis failed. Read LastError in gateway History; no incident was created.'
        elif progress == 'Completed':
            response = summary.get('Response')
            if not isinstance(response, str) or len(response) > 20000:
                raise HTTPException(502, 'Gateway response is missing or too large')
            job['response'] = response
            # Strict single outcome, tolerating the period produced by the supplied model.
            match = re.fullmatch(r'\s*(OBSTRUCTION_CONFIRMED|PATH_CLEAR|UNCERTAIN)[.!]?\s*', response, re.I)
            outcome = match.group(1).upper() if match else 'UNRECOGNIZED'
            job['outcome'] = outcome
            if outcome == 'OBSTRUCTION_CONFIRMED':
                zone = settings.camera_zones().get(job['cameraId'])
                if not zone or not zone.get('mapId') or not zone.get('polygon'):
                    job['message'] = 'Analysis completed. Configure this camera zone, then refresh this job to create the proposed incident.'
                else:
                    evidence = {'summaryId': job['summaryId'], 'cameraId': job['cameraId'],
                                'startTime': job['startTime'], 'endTime': job['endTime'],
                                'promptId': job.get('promptId'), 'response': response,
                                'zoneLabel': zone.get('label', ''), 'mappingType': zone.get('mappingType', 'unspecified')}
                    result = ingest(observation_type(cameraId=job['cameraId'], externalId=job['summaryId'],
                        obstruction=True, title='Hafnia-confirmed path obstruction',
                        explanation=f"{response}\nClip: {job['startTime']} to {job['endTime']}. Summary: {job['summaryId']}. Zone: {zone.get('label', '')} ({zone.get('mappingType', 'unspecified')}). Operator verification required.",
                        observedAt=job['startTime']), 'hafnia-gateway')
                    job['incidentId'] = result['incident']['id']
                    with store.transaction() as state:
                        item = next(r for r in state['restrictions'] if r['id'] == job['incidentId'])
                        item['hafniaEvidence'] = evidence
                    job['message'] = 'Proposed incident created; operator review required. No robot command was sent.'
            elif outcome == 'PATH_CLEAR':
                job['message'] = 'No obstruction reported. Existing restrictions were not cleared.'
            else:
                job['message'] = 'Uncertain or unrecognized answer. Review the evidence manually; no incident was created.'
        elif datetime.now(timezone.utc) - datetime.fromisoformat(job['createdAt']) > timedelta(minutes=10):
            job['progress'] = 'Timed out'
            job['message'] = 'Stopped automatic polling after 10 minutes. Refresh manually or inspect gateway History; do not resubmit blindly.'
        return save(job)

    @router.get('/prompts')
    def prompts():
        data = gateway.prompts()
        return {'prompts': [{'id': p['Id'], 'title': p['Title']} for p in data.get('PageContent', [])],
                'totalCount': data.get('TotalCount', 0)}

    @router.get('/jobs')
    def jobs():
        return {'jobs': store.read().get('hafniaJobs', [])}

    @router.post('/jobs')
    def submit(body: ClipRequest):
        camera_id, prompt_id = str(body.cameraId), str(body.promptId)
        start, end = body.startTime.astimezone(timezone.utc), body.endTime.astimezone(timezone.utc)
        current = datetime.now(timezone.utc)
        if not current - timedelta(hours=24) <= start < end <= current or end - start > timedelta(seconds=120):
            raise HTTPException(422, 'Choose a past recorded clip from the last 24 hours, between 1 and 120 seconds long')
        if end - start < timedelta(seconds=1):
            raise HTTPException(422, 'Clip must be at least one second long')
        # Resolve before reserving; this spends no VLM request.
        prompt = gateway.prompt(prompt_id)
        with store.transaction() as state:
            jobs = state.setdefault('hafniaJobs', [])
            old = next((j for j in jobs if j.get('requestId') == str(body.requestId)), None)
            if old:
                if (old['cameraId'], old.get('promptId'), old['startTime'], old['endTime']) != (
                        camera_id, prompt_id, start.strftime('%Y-%m-%dT%H:%M:%SZ'), end.strftime('%Y-%m-%dT%H:%M:%SZ')):
                    raise HTTPException(409, 'Request ID already belongs to a different clip')
                return old
            if any(j['progress'] not in TERMINAL for j in jobs):
                raise HTTPException(409, 'An analysis is already pending. Refresh it instead of submitting again.')
            today = current.date().isoformat()
            if sum(j['createdAt'].startswith(today) and not j.get('imported') for j in jobs) >= settings.gateway_daily_limit:
                raise HTTPException(429, 'RoboOps daily submission budget reached (UTC). Imports and status checks remain available.')
            stamp = now()
            job = {'id': uid('VLM'), 'requestId': str(body.requestId), 'cameraId': camera_id,
                   'promptId': prompt_id, 'promptTitle': prompt.get('Title', ''),
                   'startTime': start.strftime('%Y-%m-%dT%H:%M:%SZ'), 'endTime': end.strftime('%Y-%m-%dT%H:%M:%SZ'),
                   'createdAt': stamp, 'updatedAt': stamp, 'progress': 'Submitting', 'summaryId': None,
                   'message': 'Submission reserved. If interrupted, inspect gateway History before another request.'}
            jobs.insert(0, job)
        try:
            summary = gateway.submit(camera_id, job['startTime'], job['endTime'], prompt)
            job['summaryId'] = str(UUID(summary['Id']))
        except Exception as exc:
            job['progress'] = 'Submission uncertain'
            job['message'] = 'Submission was not confirmed. Do not automatically retry. Find the summary in gateway History and import its ID.'
            save(job)
            if isinstance(exc, HTTPException):
                return job
            if isinstance(exc, (KeyError, ValueError, TypeError)):
                return job
            raise
        # Save the accepted ID before parsing anything else; survives refresh/restart.
        job['progress'] = 'NotStarted'
        save(job)
        return consume(job, summary)

    @router.post('/jobs/{job_id}/refresh')
    def refresh(job_id: str):
        job = lookup(job_id)
        if not job.get('summaryId'):
            job['message'] = 'No accepted summary ID. Inspect gateway History and import the summary if present; do not automatically retry.'
            return job
        return consume(job, gateway.summary(job['summaryId']))

    @router.post('/import')
    def import_summary(body: ImportRequest):
        summary_id = str(body.summaryId)
        summary = gateway.summary(summary_id)
        try:
            uris = summary['Request']['VideoUris']
            if len(uris) != 1:
                raise ValueError()
            uri = urlparse(uris[0])
            camera_id = str(UUID(uri.path.removeprefix('/cameras/')))
            if uri.scheme != 'xprotect' or uri.hostname != 'localhost' or not uri.path.startswith('/cameras/'):
                raise ValueError()
            times = parse_qs(uri.query)
            start, end = times['StartTime'][0], times['EndTime'][0]
            if any(datetime.fromisoformat(t.replace('Z', '+00:00')).tzinfo is None for t in (start, end)):
                raise ValueError()
        except (KeyError, ValueError, TypeError, IndexError) as exc:
            raise HTTPException(422, 'Summary must reference exactly one XProtect localhost camera with explicit UTC clip times') from exc
        with store.transaction() as state:
            jobs = state.setdefault('hafniaJobs', [])
            job = next((j for j in jobs if j.get('summaryId') == summary_id), None)
            if not job:
                stamp = now()
                job = {'id': uid('VLM'), 'cameraId': camera_id, 'summaryId': summary_id,
                       'promptId': summary['Request'].get('PromptId'), 'startTime': start, 'endTime': end,
                       'createdAt': stamp, 'updatedAt': stamp, 'imported': True, 'progress': 'NotStarted'}
                jobs.insert(0, job)
            # A recovered accepted request resolves any uncertain reservation for this same clip.
            for pending in jobs:
                if (pending['progress'] == 'Submitting' and pending.get('summaryId') is None
                        and pending['cameraId'] == camera_id
                        and datetime.fromisoformat(pending['startTime'].replace('Z', '+00:00')) == datetime.fromisoformat(start.replace('Z', '+00:00'))
                        and datetime.fromisoformat(pending['endTime'].replace('Z', '+00:00')) == datetime.fromisoformat(end.replace('Z', '+00:00'))):
                    pending['progress'] = 'Submission uncertain'
        return consume(job, summary)

    app.include_router(router)
