# Smart City RoboOps

Municipal operations dashboard for autonomous mobile robots (AMRs). Preserve the existing product name and operations-focused visual design.

## Stack and commands

- React/TypeScript/Vite frontend in `artifacts/smart-city-roboops/frontend`.
- Python/FastAPI backend in `backend/app`; SQLite in ignored `backend/data`.
- `pnpm dev` starts both services; Vite proxies `/api` to Python on port 8000.
- `pnpm build:app` builds the dashboard; `pnpm start` serves it with FastAPI.
- `pnpm typecheck`, `pnpm test:backend`, `pnpm test:e2e` verify the application.
- Node 24, pnpm 10, Python 3.11+, and uv are required. See root README.

## Product invariants

- Approval, fleet acceptance, robot application, and replanning are independent.
- Clearance requires individual recipient application; overdue restrictions stay active.
- Proposed boundary edits invalidate review and generate new zone-set IDs. Active boundaries are immutable.
- Geometry is geographic WGS84; robot-map transforms are separate. Backend computes impact on remaining mission polylines.
- Fictional fleet delivery remains simulated and cannot accept real observations as if they were real robots.
- VDA 5050 is a future adapter target; payload previews are illustrative, not verified compliant.
- No live robot or MQTT commands are implemented.

## Integrations

User has authorized XProtect/Hafnia implementation. All provider credentials stay server-side. Configure the environment-specific URLs, Basic-user credentials, certificates, event type IDs, and surveyed camera mappings following README. The normalized callback is our own contract; the direct inference adapter requires checking the actual Hafnia endpoint profile. No live integration has been verified without the developer environment.

Replit must use ROBOOPS_OPERATOR_TOKEN. Tailscale on the user's laptop does not grant Replit cloud access. The SQLite prototype requires persistent single-instance storage; autoscale publishing is not validated. Do not silently publish, overwrite user configuration, or claim a live connection based only on configuration presence.
