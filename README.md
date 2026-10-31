# Smart City RoboOps

Municipal robot operations dashboard with a React frontend and a Python/FastAPI service. The local workflow is implemented end to end: observation, geographic mission impact, operator review, restriction delivery, individual robot application, separate replanning, and reviewed clearance.

## What works

- Google road/satellite maps and nearby embedded Street View when a browser key and coverage are available; an illustrative interactive map works without a key.
- All active/proposed restriction polygons, a searchable incident queue, editable proposed boundaries, mission and fleet views, evidence, and an audit trail.
- SQLite persistence, geometric intersection against remaining mission paths, revision checks, self-intersection validation, and explicit partial/failure outcomes.
- Independent fleet acceptance, robot application, and replan confirmation. Clearance remains pending until each required recipient applies it. Review deadlines never reopen zones.
- Server-side XProtect Basic-user authentication, camera/event queries, configured obstruction-event ingestion, and explicit publication of approved real observations as XProtect events.
- Normalized authenticated analysis webhook, plus a configurable OpenAI-compatible image-analysis adapter for Hafnia. The endpoint/profile must be checked against your supplied developer documentation.
- Fleet delivery remains simulated. VDA 5050 is an integration target, not verified compliance. No MQTT commands or live robot controls are enabled.

## Start on this Windows machine

The portable Node/pnpm tools used during development are outside the repository at `../.application-build/roboops-tools`. This helper uses those tools when Node/pnpm are not on PATH:

```powershell
cd C:\Users\subra\Desktop\Smart-City-RoboOps
powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

Open http://localhost:5173. FastAPI listens at http://127.0.0.1:8000 and Vite proxies `/api` to it. API documentation is at http://127.0.0.1:8000/docs. Stop both with Ctrl+C.

On another machine, install Node.js 24, pnpm 10, Python 3.11+, and uv, then:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

For a single-process local build:

```sh
pnpm build:app
pnpm start
```

Open http://127.0.0.1:8000. FastAPI serves the built dashboard and API on the same origin. `PORT` defaults to 8000; `ROBOOPS_BIND_HOST` defaults to 127.0.0.1. The old Node API scaffold is retained but is not the operational backend.

## Optional Google Maps

Copy `artifacts/smart-city-roboops/.env.example` to `.env` in that same directory and set `VITE_GOOGLE_MAPS_API_KEY`. Use a Google Maps JavaScript API browser key restricted to your app domains and required APIs. Restart Vite or rebuild after changing Vite variables. Google billing/API setup is separate.

The frontend default API root is `/api/v1`. For local development, `ROBOOPS_BACKEND_URL` can change Vite's proxy destination; for separate hosting use `VITE_API_BASE_URL` and configure backend CORS. Browser access to a private API still requires a permitted network path and HTTPS when the frontend is HTTPS.

## Operator session

Local loopback requests work without a token by default. Before remote or Replit access, set a strong `ROBOOPS_OPERATOR_TOKEN` in `backend/.env` or Replit Secrets. Enter the same token in **Connections > Operator session token**. Only the session token is stored in browser session storage; XProtect/Hafnia credentials stay on the server. This is a single-operator prototype, not a municipal identity/RBAC system.

## Wire XProtect and Hafnia

1. Complete the supplied Tailscale setup. Verify the API Gateway hostname from the actual machine running Python. This machine need not be Replit.
2. Copy `backend/.env.example` to `backend/.env`. Fill `XPROTECT_BASE_URL`, the actual `XPROTECT_TOKEN_URL`, and a Basic user's server-side credentials. The adapter uses the password grant; Windows NTLM login is not implemented. Trust the environment's CA through `XPROTECT_CA_BUNDLE`; certificate verification is enabled.
3. Restart Python. In **Connections**, use **Test camera access** and **Read recent events**. A successful configuration query does not establish video-stream access.
4. Copy `backend/camera-zones.example.json` to the ignored `backend/camera-zones.json`. Replace the camera key with its real GUID, use your actual map ID, and replace the sample polygon with surveyed WGS84 geometry. These polygons associate known camera regions with geographic zones; the VLM does not estimate geographic coordinates.
5. Choose one analysis ingestion path below. All external observations start as proposals and require review. They cannot be dispatched to the fictional demo fleets.

### Path A: existing Hafnia plugin produces XProtect events

Configure the plugin/analytics rules to emit a specific obstruction event type. Put its GUID(s) in `XPROTECT_OBSTRUCTION_EVENT_TYPES`. Use **Import obstruction events** to ingest stored matching events as proposals. Initial import looks back 15 minutes; subsequent imports overlap the persisted checkpoint by 30 seconds and deduplicate by camera/event ID. Paging is bounded to 5000 records; overflow fails without advancing the checkpoint. Configure XProtect event retention and choose a smaller window via the API if necessary.

For continuous near-real-time import, run this additional process after the API is up:

```sh
uv run --no-project --directory backend --with-requirements requirements.txt python -m app.poller
```

It polls every 15 seconds by default and reports failures. Actual latency includes camera/plugin inference and XProtect event delivery. Keep outgoing and incoming event type IDs different to avoid a loop.

### Path B: normalized plugin callback

A plugin-side adapter can POST to `/api/v1/hafnia/observations` with `Authorization: Bearer <HAFNIA_WEBHOOK_TOKEN>`:

```json
{
  "cameraId": "real-XProtect-camera-GUID",
  "externalId": "stable-analysis-result-id",
  "obstruction": true,
  "title": "Construction barriers across the walkway",
  "explanation": "Camera observation to be verified by an operator.",
  "observedAt": "2026-10-22T10:00:00Z"
}
```

This is RoboOps' normalized contract, not a claim that the Hafnia plugin natively emits that exact schema. Adapt the environment's documented result format to it. Repeated IDs are idempotent; negative detections never clear existing restrictions.

### Path C: direct analysis of a camera frame

After verifying the supplied Hafnia API documentation supports an OpenAI-compatible image chat-completions profile, set the complete `HAFNIA_CHAT_COMPLETIONS_URL`, `HAFNIA_MODEL`, and `HAFNIA_API_KEY`. **Connections** lets you select a mapped camera, upload an exported JPEG/PNG frame, and request analysis. A detected obstruction creates a proposal with the frame attached as evidence. Credentials and inference requests remain server-side.

There is no guessed Hafnia URL/model. Native video upload, continuous stream extraction, and Smart Client plugin result APIs require the actual environment documentation; they have not been claimed as working. If Hafnia uses a different request protocol, update `backend/app/connectors.py` against that contract.

### Feed approved observations back to XProtect

Set `XPROTECT_EVENT_TYPE_ID` to an existing user-defined/external event type that your account may trigger. An approved real observation exposes **Publish event to XProtect**. It uses the single-event REST endpoint with a correlation tag. Configure XProtect rules/alarm definitions if the event should produce an alarm; event acceptance alone does not prove an alarm exists. Publishing is explicit and is not triggered by viewing the dashboard.

## Fleet integration boundary

RoboOps submits restrictions to fleet management, which owns robot orders and zone distribution. Adapter previews deliberately contain geographic input plus a target map ID, not a fabricated standards-compliant MQTT message. A real adapter must transform geometry, assemble all active restrictions into the fleet's complete zone set, validate the version/capabilities, and reconcile robot state. A new zone-set ID is assigned when proposed geometry changes and for a clearance revision.

## Replit and deployment

The Run workflow starts `pnpm dev`. Replit needs Python and uv available and an operator token in Secrets. Replit cloud processes do not inherit your laptop's Tailscale access. For the first live demo, running the complete app on your authorized local machine is the simplest arrangement.

No deployment is performed by these changes. The existing autoscale publishing scaffold is not a validated durable deployment for this SQLite prototype. Use one service instance on a persistent disk, or migrate storage before deploying to ephemeral/multiple instances. Run the event poller in a continuously running process when needed. Do not expose the VMS itself to the public internet to make the UI work.

## Verification

```sh
pnpm typecheck
pnpm test:backend
pnpm build:app
pnpm test:e2e
```

Browser tests use a separate SQLite database and a test token, and run headless Edge on Windows. Elsewhere install Chromium with `pnpm exec playwright install chromium`. They test the operator workflow, invalid geometry, persistence across reload, connection settings, and mobile layout. Backend tests mock external services: live XProtect/Hafnia connectivity and Google imagery require your environment configuration.

## Primary references

- [XProtect REST events and authentication examples](https://doc.developer.milestonesys.com/mipvmsapi/api/events-rest/v1/)
- [Milestone integration APIs](https://doc.developer.milestonesys.com/mipvmsapi/)
- [VDA 5050 released 3.0 specification](https://github.com/VDA5050/VDA5050/blob/3.0.0/VDA5050_EN.md)
