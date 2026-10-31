"""Optional event bridge: run beside the API after configuring obstruction event IDs."""
import os
import time

import httpx

from .config import Settings


def main():
    settings = Settings()
    base = os.getenv('ROBOOPS_BACKEND_URL', 'http://127.0.0.1:8000').rstrip('/')
    interval = max(10, int(os.getenv('ROBOOPS_POLL_SECONDS', '15')))
    headers = {'Authorization': 'Bearer ' + settings.operator_token} if settings.operator_token else {}
    with httpx.Client(timeout=120, trust_env=False) as client:
        while True:
            try:
                response = client.post(base + '/api/v1/xprotect/import-events', headers=headers)
                if response.is_success:
                    print('Event bridge:', response.json(), flush=True)
                else:
                    print(f'Event bridge HTTP {response.status_code}; check Connections and server configuration.', flush=True)
            except httpx.HTTPError:
                print('Event bridge cannot reach RoboOps API; retrying.', flush=True)
            time.sleep(interval)


if __name__ == '__main__':
    main()
