# Future FastAPI contract

This is a proposal for replacing the frontend's mock services. It is documentation only: this prototype does not run or call a backend. The intended future server is Python with FastAPI, not Node/Express.

## Proposed endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/dashboard` | Fleet, mission, active-restriction and recent-event summary |
| `GET` | `/api/v1/incidents` | Filterable incident queue (`status`, `q`, `limit`, `cursor`) |
| `POST` | `/api/v1/incidents/simulate` | Demo-only construction-barrier observation linked to a GeoJSON polygon, robot `mapId`, and exactly two affected missions |
| `GET` | `/api/v1/incidents/{incident_id}` | Observation, review state, affected missions, recipients and dispatch history |
| `PATCH` | `/api/v1/restrictions/{restriction_id}/boundary` | Validate and save a GeoJSON polygon; issue a new `zoneSetId` when contents change |
| `POST` | `/api/v1/restrictions/{restriction_id}/review` | Approve or reject with operator identity and rationale |
| `POST` | `/api/v1/restrictions/{restriction_id}/deliveries` | Explicit delivery attempt for one recipient |
| `POST` | `/api/v1/restrictions/{restriction_id}/deliveries/{robot_id}/retry` | Explicit retry after a partial or failed outcome |
| `POST` | `/api/v1/restrictions/{restriction_id}/clearance/review` | Request or decide operator clearance review |
| `POST` | `/api/v1/restrictions/{restriction_id}/clearance/deliveries` | Send approved clearance and record fleet acknowledgement |
| `GET` | `/api/v1/missions`, `/api/v1/robots`, `/api/v1/fleet-profiles` | Read-only operational snapshots |

## Example request and response models

### Boundary update request

```json
{
  "geometry": {
    "type": "Polygon",
    "coordinates": [
      [
        [10.20995, 56.16025],
        [10.21045, 56.16065],
        [10.21095, 56.16045],
        [10.21055, 56.16005],
        [10.20995, 56.16025]
      ]
    ]
  },
  "expectedZoneSetId": "ZS-2048-A"
}
```

### Review request and response

```json
{
  "decision": "approve",
  "rationale": "Boundary checked against the visible work area."
}
```

```json
{
  "incidentId": "OBS-2048",
  "approvalStatus": "Approved",
  "deliveryStatus": "Not sent",
  "zoneSetId": "ZS-2048-B",
  "active": true
}
```

### Per-recipient delivery response

```json
{
  "restrictionId": "OBS-2048",
  "recipientId": "Moss-03",
  "status": "Fleet accepted",
  "robotApplicationStatus": "Awaiting acknowledgement",
  "replanStatus": "Not confirmed",
  "correlationId": "demo-correlation-id",
  "updatedAt": "2026-10-22T09:44:12Z"
}
```

Per-recipient delivery states are `Not sent`, `Sending`, `Fleet accepted`, `Robot applied`, `Rejected`, `Timed out`, `Unsupported`, and `Failed`. Approval, fleet acceptance, robot application, and a successful replan are distinct facts and must not be inferred from one another.

## Contract and safety rules

- Use RFC 7946 GeoJSON longitude/latitude ordering. Validate ring closure, coordinate ranges, polygon validity, and optimistic concurrency through `expectedZoneSetId`.
- Keep geographic coordinates separate from robot-specific map coordinates. Require an explicitly configured alignment before dispatch.
- The application submits restrictions to fleet management. Fleet management remains responsible for robot orders and zone distribution.
- Record state transitions as append-only events with UTC timestamp, actor, recipient, adapter profile/version, and correlation ID.
- Check declared adapter capabilities and return `Unsupported` rather than silently changing an operation.
- Keep expired or overdue restrictions active until an operator reviews and clears them through the separate clearance-delivery acknowledgement cycle. Never reopen an area automatically.
- VDA 5050 is an adapter target only. Capability declarations do not establish verified compliance.
- Any adapter payload previews must be labeled illustrative and unvalidated until checked against an authorized integration.
- Protect the future API with appropriate municipal identity, authorization, audit logging and data-retention controls. This demo intentionally has none.

## Frontend configuration boundary

The current UI always uses local mock services. When an HTTP client is introduced, configure its base URL with `VITE_API_BASE_URL`; default it to `/api` for same-origin deployments. The environment example includes this setting. A configured URL alone does not enable live requests.
