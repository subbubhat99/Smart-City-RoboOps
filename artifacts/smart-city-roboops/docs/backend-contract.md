# Implemented FastAPI contract

The Python service at `backend/app/main.py` is authoritative. Open `/docs` or `/openapi.json` on that service for the exact request/response definitions. Configuration and live integration steps are in the root README.

| Method | Path under `/api/v1` | Purpose |
|---|---|---|
| GET | `/dashboard` | Robots, missions, restrictions, integration configuration and server time |
| GET | `/incidents`, `/incidents/{id}` | Incident snapshots |
| POST | `/incidents/simulate` | New fictional obstruction with geometrically computed remaining-route impact |
| PATCH | `/restrictions/{id}/boundary` | Proposed boundary update; new zone-set ID and renewed review |
| POST | `/restrictions/{id}/actions` | Explicit guarded state transition |
| GET | `/restrictions/{id}/preview?robotId=...` | Illustrative fleet-adapter input, not a validated VDA message |
| POST | `/demo/reset` | Reset simulation records while retaining external observations |
| GET | `/integrations` | Non-secret configuration status |
| GET | `/xprotect/cameras`, `/xprotect/events` | Server-side API Gateway queries |
| POST | `/xprotect/import-events?since=...` | Ingest mapped, configured obstruction event types |
| POST | `/incidents/{id}/xprotect-event` | Explicit publication of approved external observations |
| POST | `/hafnia/analyze` | Configured image-profile inference; creates a proposal on obstruction |
| POST | `/hafnia/observations` | Normalized plugin callback using a separate webhook token |

Mutation example:

```json
{"action":"dispatch","expectedRevision":3,"robotId":"Moss-03","reason":"Boundary inspected","outcome":"Fleet accepted"}
```

Valid actions are `begin_review`, `approve`, `reject`, `dispatch`, `robot_response`, `confirm_replan`, `request_clearance`, `approve_clearance`, `dispatch_clearance`, `clearance_response`, and `close_unsent`. Outcomes can be injected only for the fictional adapter. Robot application cannot be injected at the submission step.

Boundary body: `{ "expectedRevision": 2, "polygon": [{"lat":56.16,"lng":10.21}, ...] }`. The frontend's GeoJSON editor converts its single closed ring to these point objects. Backend validation rejects invalid ranges, degenerate polygons, and self-intersections.

A restriction includes separate `status`, `recipients`, `replans`, `clearance`, and `clearanceRecipients`. HTTP 409 means an invalid transition or a stale revision; refresh rather than overwriting. Approval never implies delivery, application never implies successful replanning, and clearance cannot complete while a required robot's acknowledgement is missing.

The public `/api/health` endpoint is outside the v1 prefix. Other endpoints require an operator bearer token when configured; remote/Replit requests cannot omit server authentication. Local loopback use without a token is supported for development only.

SQLite data is stored under the ignored `backend/data/` directory. Provider credentials are loaded from the ignored backend `.env` and never returned by configuration endpoints.
