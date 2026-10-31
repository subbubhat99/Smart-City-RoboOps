"""Server-only configuration; provider URLs are supplied by the environment owner."""
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env')


@dataclass
class Settings:
    database: str = field(default_factory=lambda: os.getenv('ROBOOPS_DATABASE', str(ROOT / 'data' / 'roboops.sqlite3')))
    operator_token: str = field(default_factory=lambda: os.getenv('ROBOOPS_OPERATOR_TOKEN', ''))
    cors_origins: list[str] = field(default_factory=lambda: os.getenv('ROBOOPS_CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(','))
    xprotect_url: str = field(default_factory=lambda: os.getenv('XPROTECT_BASE_URL', '').rstrip('/'))
    xprotect_token_url: str = field(default_factory=lambda: os.getenv('XPROTECT_TOKEN_URL', ''))
    xprotect_username: str = field(default_factory=lambda: os.getenv('XPROTECT_USERNAME', ''))
    xprotect_password: str = field(default_factory=lambda: os.getenv('XPROTECT_PASSWORD', ''))
    xprotect_client_id: str = field(default_factory=lambda: os.getenv('XPROTECT_CLIENT_ID', 'GrantValidatorClient'))
    xprotect_event_type: str = field(default_factory=lambda: os.getenv('XPROTECT_EVENT_TYPE_ID', ''))
    obstruction_event_types: list[str] = field(default_factory=lambda: [s.strip() for s in os.getenv('XPROTECT_OBSTRUCTION_EVENT_TYPES', '').split(',') if s.strip()])
    ca_bundle: str = field(default_factory=lambda: os.getenv('XPROTECT_CA_BUNDLE', ''))
    hafnia_url: str = field(default_factory=lambda: os.getenv('HAFNIA_CHAT_COMPLETIONS_URL', ''))
    hafnia_key: str = field(default_factory=lambda: os.getenv('HAFNIA_API_KEY', ''))
    hafnia_model: str = field(default_factory=lambda: os.getenv('HAFNIA_MODEL', ''))
    webhook_token: str = field(default_factory=lambda: os.getenv('HAFNIA_WEBHOOK_TOKEN', ''))
    camera_zones_path: str = field(default_factory=lambda: os.getenv('ROBOOPS_CAMERA_ZONES', str(ROOT / 'camera-zones.json')))

    def camera_zones(self):
        import json
        path = Path(self.camera_zones_path)
        return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
