"""VM-local Hafnia gateway, following HackathonKit's gateway-api.md.

The TLS exception is opt-in and applies ONLY to this fixed loopback gateway.
No request submission is retried after transport errors.
"""
import threading
import time

import httpx
from fastapi import HTTPException


class Gateway:
    def __init__(self, settings, transport=None):
        self.settings, self.transport = settings, transport
        self.session, self.expires = '', 0
        self.lock = threading.Lock()

    def client(self):
        return httpx.Client(base_url='https://localhost:15443', timeout=30,
                            verify=not self.settings.gateway_self_signed,
                            transport=self.transport, trust_env=False,
                            follow_redirects=False)

    def login(self):
        if not self.settings.gateway_password:
            raise HTTPException(503, 'Set HAFNIA_GW_PASSWORD in the backend process environment on the VM')
        with self.lock:
            if self.session and time.monotonic() < self.expires:
                return self.session
            with self.client() as client:
                response = client.post('/api/Sessions/Login', json={
                    'Name': self.settings.gateway_user, 'Password': self.settings.gateway_password})
                response.raise_for_status()
                self.session = response.json()['Id']
                self.expires = time.monotonic() + 8 * 3600 - 60
                return self.session

    def call(self, method, path, **kwargs):
        try:
            for attempt in range(2):
                session = self.login()
                with self.client() as client:
                    response = client.request(method, path, headers={'X-Session-Id': session}, **kwargs)
                # A definite authentication rejection is safe to retry. Transport errors are not.
                if response.status_code == 401 and attempt == 0:
                    self.session, self.expires = '', 0
                    continue
                response.raise_for_status()
                return response.json()
        except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
            status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
            raise HTTPException(502, 'Hafnia gateway request failed' + (f' (HTTP {status})' if status else '') +
                                '. Check the VM gateway, runtime credentials and local certificate setting. See gateway History for analysis errors.') from exc

    def prompts(self):
        return self.call('GET', '/api/Prompts', params={'Limit': 100, 'Offset': 0})

    def prompt(self, prompt_id):
        result = self.call('GET', '/api/Prompts/' + prompt_id)
        if not isinstance(result, dict) or not result.get('Text') or not result.get('Id'):
            raise HTTPException(422, 'Saved gateway prompt was not found or has no text')
        return result

    def submit(self, camera_id, start, end, prompt):
        uri = f'xprotect://localhost/cameras/{camera_id}?StartTime={start}&EndTime={end}'
        return self.call('POST', '/api/Summaries', json={
            'PromptId': prompt['Id'], 'Prompt': prompt['Text'], 'VideoUris': [uri]})

    def summary(self, summary_id):
        return self.call('GET', '/api/Summaries/' + summary_id)
