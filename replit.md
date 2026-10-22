# Smart City RoboOps

An operations dashboard for municipal autonomous mobile robots (AMRs) performing outdoor groundskeeping and sanitary maintenance of paved public spaces.

## Run & Operate

- `pnpm --filter @workspace/smart-city-roboops run dev` — run the frontend preview
- `pnpm --filter @workspace/smart-city-roboops run typecheck` — check the app's TypeScript
- `pnpm run typecheck` — full typecheck across all packages
- Optional env: `VITE_GOOGLE_MAPS_API_KEY` — domain-restricted browser key for Google road/satellite maps; the app must remain useful without it.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite
- Current prototype: simulated operations with localStorage persistence; no app backend, database, authentication, MQTT, or live robot/fleet integrations.
- Future backend: Python + FastAPI, described in `artifacts/smart-city-roboops/docs/backend-contract.md`.

## Where things live

- `artifacts/smart-city-roboops/` — Smart City RoboOps web app
- `artifacts/smart-city-roboops/frontend/` — frontend code and operation services
- `artifacts/smart-city-roboops/docs/backend-contract.md` — proposed future FastAPI contract and local setup notes

## Architecture decisions

- Approval, fleet acceptance, and per-robot application are separate states.
- Geographic coordinates and robot map coordinates remain separate; simulated dispatch is blocked until the labeled demo alignment is configured.
- VDA 5050 is a future adapter target only; the prototype makes no verified-compliance claim.
- Restriction clearance requires operator review and its own delivery/acknowledgement cycle; overdue restrictions remain active.

## Product

Operators review simulated obstruction observations, edit proposed GeoJSON exclusion zones, see affected missions, approve or reject restrictions, and track fictional fleet/robot delivery outcomes. All robot movement, footage, fleet responses, and rerouting are simulated.

## User preferences

- Use the product name “Smart City RoboOps”; do not call the dashboard “CityFleet Operations.”
- In this project, AMR means autonomous mobile robot.

## Gotchas

- Google Maps is optional; do not make a key a prerequisite for running or using the prototype.
- Never imply that approval means delivery, fleet acceptance means robot application, or message submission means successful replanning.
- Do not connect this prototype to XProtect, Hafnia, real robots, or MQTT.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
